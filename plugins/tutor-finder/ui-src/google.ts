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

/** Google answered a step with an HTTP error. The body is never kept: it may echo sheet data. */
export class SheetReadFailed extends Error {
  constructor(
    readonly step: "token" | "values",
    readonly status: number,
  ) {
    super(`Google answered the ${step} request with HTTP ${String(status)}`);
  }
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
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new SheetReadFailed("values", res.status);
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
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(key.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, // script can never read the key back out of the CryptoKey
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(unsigned),
  );
  // A form-urlencoded POST is a CORS simple request: no preflight.
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
    }),
  });
  if (!res.ok) throw new SheetReadFailed("token", res.status);
  return Token.parse(await res.json()).access_token;
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
