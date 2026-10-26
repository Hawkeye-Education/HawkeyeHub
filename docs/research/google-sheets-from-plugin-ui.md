# Research: Calling Google Sheets from a Plugin UI

Resolves #157. Feeds the Teacher Finder port spec (#158). **Facts and trade-offs only. This doc makes no decision.**

Researched 2026-10-26 against the Hub's installed Electron 44.5.1 (Chromium 152.0.7977.130). Each claim is tagged **[verified]** (run here, output quoted), **[source]** (stated by a primary source, linked) or **[inferred]** (our reading, not stated anywhere).

## TL;DR

- **Yes, it works with `fetch` and WebCrypto alone.** A probe page served from `hawkeye-plugin://teacher-finder/`, in a sandboxed `WebContentsView` with the Hub's exact scheme privileges, signed an RS256 JWT with WebCrypto, posted it to `oauth2.googleapis.com/token`, and called Sheets `values.get`. Both responses were readable, so CORS passed. Google rejected the throwaway key and the fake token, as expected. **[verified]**
- **Origin:** Chromium sends `Origin: hawkeye-plugin://teacher-finder`, because the scheme is `standard`. Both Google endpoints echo any origin back in `Access-Control-Allow-Origin`, including a custom scheme and `null`. **[verified]**
- **`corsEnabled` changes nothing here.** It does not change the Origin or the outcome. What matters is `standard` + `secure`. Without `standard`, the origin becomes opaque (`null`) and the page stops being a secure context, which removes `crypto.subtle`. **[verified]** The Hub registers `hawkeye-plugin` with `{standard, secure, supportFetchAPI}`, not `corsEnabled` (`apps/hub/src/main/index.ts`).
- **The real problem is the key, not the transport.** If the Plugin UI does the signing, the service-account private key must reach the renderer. There it can be read by anyone who has the Plugin, and by DevTools in dev mode. Google says keys must be stored securely. **[source]**
- **Fallbacks** (CORS does not fail, so none of these is required): a Python Backend with `google-auth` (keeps the key out of the renderer); a Hub-side `hub.fetch` (ADR 0009, still unbuilt, and it does not solve the key problem); an API key against a sheet shared as "Anyone with the link" (no secret, but the sheet becomes public).

## 1. CORS from a custom-scheme origin

### 1.1 What the Hub registers

`apps/hub/src/main/index.ts` makes the Hub's one `protocol.registerSchemesAsPrivileged` call:

```ts
{ scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
```

`corsEnabled` is set only on the icon and Hub Kit schemes, not on `hawkeye-plugin`. Each Plugin gets the scheme on its own partition `persist:plugin-<id>` (`plugin-views.ts`, `plugin-scheme.ts`). `plugin-lockdown.ts` limits navigation, windows, permissions and downloads. It installs no `webRequest` filter and no CSP, so outbound `fetch` is unrestricted. **[verified, by reading the source]**

Electron's docs say a standard scheme follows RFC 3986 generic URI syntax, so relative URLs resolve. They also say web storage is disabled for non-standard schemes ([protocol](https://www.electronjs.org/docs/latest/api/protocol)). The [CustomScheme structure](https://www.electronjs.org/docs/latest/api/structures/custom-scheme) lists `corsEnabled` but gives it no description beyond "Default false". **[source]** Neither page says what Origin a page on the scheme sends.

### 1.2 What Google returns (curl, no credentials)

These are a preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) and a real request with a bogus body or bearer token, sent to both endpoints with three Origins: `hawkeye-plugin://teacher-finder`, `null` and `https://example.com`. All three gave the same pattern **[verified]**:

| Request | Status | CORS headers |
|---|---|---|
| `OPTIONS https://oauth2.googleapis.com/token` (POST, `content-type`) | 200 | `Access-Control-Allow-Origin: <the Origin sent>`, `Allow-Methods: DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT`, `Allow-Headers: content-type`, `Max-Age: 3600` |
| `POST /token` with a bogus assertion | 400 `invalid_request` | `Access-Control-Allow-Origin: <the Origin sent>` |
| `OPTIONS https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}` (GET, `authorization`) | 200 | `Access-Control-Allow-Origin: <the Origin sent>`, `Allow-Headers: authorization`, `Max-Age: 3600` |
| `GET .../values/{range}` with `Authorization: Bearer invalid` | 401 | `Access-Control-Allow-Origin: <the Origin sent>`, `Expose-Headers: www-authenticate,...` |

Google reflects the request Origin, whatever it is, and sends no `Access-Control-Allow-Credentials`. That is fine, because neither call needs cookies.

### 1.3 What Chromium actually sends (Electron probe)

The probe is a throwaway Electron main script, run with the Hub's own `electron.exe` and kept outside the repo. It registers `hawkeye-plugin` with each privilege set below, serves one HTML page through `session.protocol.handle` on a `persist:` partition, and loads it in a `WebContentsView` with `sandbox: true, contextIsolation: true, nodeIntegration: false`, as `plugin-views.ts` does. The page does the following:

1. It imports a freshly generated, throwaway RSA-2048 PKCS#8 key (never a real service account) with `crypto.subtle.importKey("pkcs8", der, {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["sign"])`.
2. It signs a Google-shaped JWT (`iss`, `scope=…/spreadsheets.readonly`, `aud=https://oauth2.googleapis.com/token`, `iat`, `exp=iat+3600`).
3. It POSTs the JWT as `application/x-www-form-urlencoded` to `/token`.
4. It GETs `values/Class Data!A1:B2?valueRenderOption=UNFORMATTED_VALUE` with a fake bearer token.

`session.webRequest.onBeforeSendHeaders` logged the `Origin` header, and main verified the signature with Node's `crypto.verify`.

| Privileges | `location.origin` | `isSecureContext` / `crypto.subtle` | Origin sent | `/token` result | Sheets result |
|---|---|---|---|---|---|
| **Hub's:** `standard, secure, supportFetchAPI` | `hawkeye-plugin://teacher-finder` | true / present | `hawkeye-plugin://teacher-finder` | 400 `invalid_grant: account not found`, body readable | 401, body readable |
| plus `corsEnabled` | same | true / present | same | same | same |
| `secure, supportFetchAPI`, **no `standard`** | `null` | **false / absent** | `null` | 400 `invalid_request`, body readable (no JWT could be signed) | 401, body readable |

Every row is **[verified]**. The findings:

- `invalid_grant: account not found` means Google parsed the JWT and looked up `iss`. The RS256 signature was well-formed, and Node verified it against the public key (`signatureVerifiesWithNode: true`).
- The token POST went out with **no preflight**: `onBeforeSendHeaders` logged no `OPTIONS` before it. A form-urlencoded POST is a CORS "simple request" ([MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#simple_requests)). The Sheets GET was preflighted, because of `Authorization`, and the preflight passed.
- `corsEnabled` is irrelevant for outbound requests from the scheme. Its job is not documented by Electron **[source: absence]**. Our reading is that it governs the scheme as a CORS *target*, as the Hub's own comment on the icon scheme assumes. **[inferred]**

## 2. WebCrypto and the service-account key

- **Supported.** `importKey` accepts `"pkcs8"`, a DER `PrivateKeyInfo`, for RSA private keys, and RSASSA-PKCS1-v1_5 with SHA-256 is RS256 ([MDN importKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey)). **[source]** It worked in the probe. **[verified]**
- **The key format matches.** A Google JSON key's `private_key` is `"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"`, which is PKCS#8 ([IAM: create keys](https://docs.cloud.google.com/iam/docs/keys-create-delete)). **[source]**
- **What Google requires** ([OAuth 2.0 for service accounts, HTTP/REST](https://developers.google.com/identity/protocols/oauth2/service-account)) **[source]**:
  - The header is `{"alg":"RS256","typ":"JWT"}`, and RS256 is the only signing algorithm Google accepts.
  - The claims are `iss` (the `client_email`), `scope`, `aud=https://oauth2.googleapis.com/token`, `iat`, and `exp`, which may be at most `iat` + 1 hour.
  - The request is a POST to `https://oauth2.googleapis.com/token`, URL-encoded, with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>`.
- **Pitfalls:**
  - It needs a secure context. Only `standard` + `secure` gives one, as the table above shows. If a future change drops `standard`, `crypto.subtle` silently disappears. **[verified]**
  - The PEM must be turned into DER: strip the header and footer lines and whitespace, then `atob`. MDN's example cuts by fixed offsets ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey)). A regex that removes every `-----…-----` line and all whitespace is more forgiving of the trailing `\n` in Google's key. **[verified, as used in the probe]**
  - A `BEGIN RSA PRIVATE KEY` (PKCS#1) PEM will not import as `"pkcs8"`. Google's keys are PKCS#8, but hand-converted keys may not be. **[inferred]**
  - JWT segments are **base64url without padding**, and that includes the signature. `btoa` gives standard base64, so map `+/` to `-_` and strip `=`. **[source: RFC 7515 §2; verified by Node accepting the signature]**
  - A local clock that runs fast can make `iat`/`exp` invalid. Because tokens last 1 hour, cache the access token and re-mint it near expiry rather than for every call. **[inferred from the 1-hour rule]**
  - Import with `extractable: false`. This stops script from reading the key back out of the `CryptoKey`, but the PEM text it was imported from was already in the renderer. **[inferred]**
- **The key's exposure is the real cost.** Google: "If you don't store your keys securely, then bad actors can find the keys and use them to access the resources that the service account can access." It recommends a key store, or Workload Identity Federation instead of keys ([IAM: create keys](https://docs.cloud.google.com/iam/docs/keys-create-delete)). **[source]** Doing the signing in the Plugin UI means the PEM sits in renderer memory and in whatever file it was loaded from, and DevTools in dev mode can read it. With `spreadsheets.readonly`, a leaked key can read any sheet shared with that service account. It can also call any other API enabled on its project that the account has rights to, because a JWT can name any scope. **[inferred]** If today's Teacher Finder already keeps the key file on staff machines, the exposure is about the same and does not get worse. **[inferred; where it keeps the key was not checked]**

## 3. Options

CORS does not fail, so the direct route stands. The options differ in where the secret lives:

| Option | Works today? | Where the key lives | Notes |
|---|---|---|---|
| **A. Plugin UI: WebCrypto + `fetch`** | Yes **[verified]** | Readable in the renderer (Plugin Data or a picked file) | No Backend and no new Hub API. Its exposure matches today's Teacher Finder. |
| **B. Python Backend with `google-auth`** | Yes, Backend support exists (ADR 0003) | Python process only, never the renderer | Requires a Python Plugin, which adds the runtime (ADR 0011). `service_account.Credentials.from_service_account_file` handles token caching and refresh. The UI calls the Backend through `hub.backend.request`. |
| **C. `hub.fetch`** (ADR 0009 "when a UI-only Plugin hits CORS") | Not built | Still the renderer, because the UI signs | It solves only CORS, which is not the problem here. It would hide the key only if the Hub also took over the signing, which would be a new Hub API. |
| **D. API key + sheet shared "Anyone with the link"** | Yes **[inferred]**; Google says API keys "anonymously access publicly available data", e.g. files shared with "Anyone on the Internet with this link" ([create credentials](https://developers.google.com/workspace/guides/create-credentials)) **[source]** | An API key, which is not a secret granting data access | The teacher data becomes public to anyone with the sheet URL. That is likely unacceptable for staff contact data. **[inferred]** |

Not researched: `values.get` with an API key against the probe sheet. Its CORS headers are the same endpoint's, so they should match the table above **[inferred]**.

## Reproducing

- Run the curl checks in §1.2 with `curl -i -X OPTIONS <url> -H "Origin: hawkeye-plugin://teacher-finder" -H "Access-Control-Request-Method: POST|GET" -H "Access-Control-Request-Headers: content-type|authorization"`.
- The Electron probe is about 70 lines and is described step by step in §1.3. Run it with `apps/hub/node_modules/electron/dist/electron.exe probe.cjs --variant=hub|cors|nonstandard`. It uses a key generated at run time and a public sample sheet ID, and never real credentials.
