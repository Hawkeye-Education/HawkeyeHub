// Reads the tutor sheet straight from the Plugin UI, with no Backend: the service-account key signs
// an RS256 JWT with WebCrypto, the JWT buys an access token, and the token reads the sheet
// (docs/research/google-sheets-from-plugin-ui.md). Read-only: it never writes to the sheet.
// Nothing here logs, and no error message carries a response body: rows hold staff contact data.

import { z } from "zod";

/** The Plugin Secret holding the downloaded service-account `.json`, as its text. */
export const KEY_SECRET = "google-service-account";

const SHEET_ID = "1eMCPW0iBG8wdBCBiu7ueiUrdciWPCVkMGTIoboeeO1s";
const RANGE = "Sheet1"; // the whole tab
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_LIFETIME_S = 3600; // the most Google allows

// Not strict: Google's key file has more fields (project_id, private_key_id, …) this never reads.
const ServiceAccountKey = z.object({
  type: z.literal("service_account"),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});
export type ServiceAccountKey = z.infer<typeof ServiceAccountKey>;

export type KeyParse =
  { kind: "valid"; key: ServiceAccountKey } | { kind: "invalid" };

/** A key file's text, checked at the boundary: staff's picked file, or the stored Plugin Secret. */
export function parseKey(text: string): KeyParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "invalid" }; // not JSON at all: refused like any other wrong file
  }
  const parsed = ServiceAccountKey.safeParse(json);
  return parsed.success
    ? { kind: "valid", key: parsed.data }
    : { kind: "invalid" };
}

/** Why a read failed, as staff can act on it: replace the key, share the sheet, or try again. */
export type ReadFailure = "keyRejected" | "noAccess" | "unreachable";

/** A read failed in a way staff can act on. Anything else `readSheet` throws is a bug, and
 * propagates. No response body is kept: it may echo sheet data. */
export class SheetReadFailed extends Error {
  constructor(readonly failure: ReadFailure) {
    super(`The tutor sheet read failed: ${failure}`);
  }
}

type Step = "token" | "values";

/** What Google's HTTP error at `step` means for staff. */
function httpFailure(step: Step, status: number): ReadFailure {
  // The token endpoint answers a revoked, deleted or garbled key with 400 invalid_grant, or 401.
  if (step === "token")
    return status === 400 || status === 401 ? "keyRejected" : "unreachable";
  if (status === 401) return "keyRejected";
  // The service account was never given the sheet, or the sheet is gone: 403 or 404.
  if (status === 403 || status === 404) return "noAccess";
  return "unreachable"; // 5xx, and 429 rate limiting
}

/** `fetch` for one step, its failures as SheetReadFailed. */
async function call(
  step: Step,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // fetch rejects with a TypeError when the network fails (Fetch Standard, "network error").
    if (e instanceof TypeError) throw new SheetReadFailed("unreachable");
    throw e;
  }
  if (!res.ok) throw new SheetReadFailed(httpFailure(step, res.status));
  return res;
}

const Token = z.object({ access_token: z.string().min(1) });
// FORMATTED_VALUE (the default) gives every cell as a string. Google leaves out `values` for an
// empty range and trailing blank cells in a row; parseRows reads a short row as blanks.
const ValueRange = z.object({
  values: z.array(z.array(z.string())).optional(),
});

/** The whole tab as the Sheets API value grid, header row first. */
export async function readSheet(key: ServiceAccountKey): Promise<string[][]> {
  const token = await accessToken(key);
  const res = await call(
    "values",
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return ValueRange.parse(await res.json()).values ?? []; // absent `values`: an empty tab
}

// ponytail: a fresh token for every read; reads are once per open plus Refresh, so no token cache.
async function accessToken(key: ServiceAccountKey): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = [
    { alg: "RS256", typ: "JWT" },
    {
      iss: key.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + TOKEN_LIFETIME_S,
    },
  ]
    .map((part) => base64url(new TextEncoder().encode(JSON.stringify(part))))
    .join(".");
  const signingKey = await importKey(key.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(unsigned),
  );
  // A form-urlencoded POST is a CORS simple request: no preflight.
  const res = await call("token", TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
    }),
  });
  return Token.parse(await res.json()).access_token;
}

/** The key's private_key as a signing key. One that isn't base64 PKCS#8 RSA is a key that isn't valid. */
async function importKey(pem: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      pemToDer(pem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, // script can never read the key back out of the CryptoKey
      ["sign"],
    );
  } catch (e) {
    // atob throws an InvalidCharacterError and importKey a DataError (MDN), by name: the
    // DOMException can come from another realm, as Node's WebCrypto under test does. A test pins it.
    if (
      e instanceof Error &&
      (e.name === "InvalidCharacterError" || e.name === "DataError")
    )
      throw new SheetReadFailed("keyRejected");
    throw e;
  }
}

/** A PKCS#8 PEM's DER bytes: every `-----…-----` line and all whitespace removed. */
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** Base64url without padding, as every JWT segment is (RFC 7515 §2). */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
