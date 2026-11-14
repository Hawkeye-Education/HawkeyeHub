// What the Plugin needs to reach the Cash Flow Sheet, checked at the boundary: the service-account
// key (a Plugin Secret) and the sheet's ID, parsed out of the link staff paste. The ID never lives
// in the repo, which is public. Nothing here logs: the key is a secret.

import { z } from "zod";
import type { HkdCents } from "./amountInWords";
import { CalendarDate } from "./invoice";
import { parseAmount } from "./review";

/** The Plugin Secret holding the downloaded service-account `.json`, as its text. */
export const KEY_SECRET = "google-service-account";

// Not strict: Google's key file has more fields (project_id, private_key_id, …) this never reads.
const ServiceAccountKey = z.object({
  type: z.literal("service_account"),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});
export type ServiceAccountKey = z.infer<typeof ServiceAccountKey>;

export type KeyParse =
  { kind: "valid"; key: ServiceAccountKey } | { kind: "invalid" };

/** A key file's text: staff's picked file, or the stored Plugin Secret. */
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

/** A Google Sheets spreadsheet ID, as it appears in the sheet's link. */
export const SheetId = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .brand<"SheetId">();
export type SheetId = z.infer<typeof SheetId>;

/** The ID in a Google Sheets link (`https://docs.google.com/spreadsheets/d/<id>/…`), or none. */
export function parseSheetLink(
  text: string,
): { kind: "valid"; id: SheetId } | { kind: "invalid" } {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { kind: "invalid" }; // not a URL at all
  }
  const match = /^\/spreadsheets\/d\/([^/]+)/.exec(url.pathname);
  const id = SheetId.safeParse(match?.[1]);
  return url.protocol === "https:" &&
    url.hostname === "docs.google.com" &&
    id.success
    ? { kind: "valid", id: id.data }
    : { kind: "invalid" };
}

/** The link that opens the sheet `id`, to show in Settings. */
export function sheetLink(id: SheetId): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

// --- Reading the sheet ------------------------------------------------------------------------
// Lifted from Tutor Finder's approach, not shared with it: the key signs an RS256 JWT with
// WebCrypto, the JWT buys an access token, the token reads the range. Read-only, never written.
// No error message carries a response body: it may echo sheet rows.

/** Tab `Cashflow_sheet`, columns A–L, from the header on row 6 (spec #188). */
const RANGE = "Cashflow_sheet!A6:L";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_LIFETIME_S = 3600; // the most Google allows

/** Why a read failed, as staff can act on it: replace the key, share the sheet, or try again. */
export type ReadFailure = "keyRejected" | "noAccess" | "unreachable";

/** A read failed in a way staff can act on. Anything else `readSheet` throws is a bug. */
export class SheetReadFailed extends Error {
  constructor(readonly failure: ReadFailure) {
    super(`The Cash Flow Sheet read failed: ${failure}`);
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
// empty range and trailing blank cells in a row ("For output, empty trailing rows and columns will
// not be included": https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values#ValueRange),
// so parseCashFlow reads a short row as blanks.
const ValueRange = z.object({
  values: z.array(z.array(z.string())).optional(),
});

/** The range as the Sheets API value grid, header row first. */
export async function readSheet(
  key: ServiceAccountKey,
  id: SheetId,
): Promise<string[][]> {
  const token = await accessToken(key);
  const res = await call(
    "values",
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(RANGE)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  // Absent `values` is an empty range (ValueRange docs above; the "an empty range" test covers it).
  return ValueRange.parse(await res.json()).values ?? [];
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

/** The key's private_key as a signing key. One that isn't base64 PKCS#8 RSA is a rejected key. */
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

// --- Parsing the rows ---------------------------------------------------------------------------

/** The header row the Plugin reads by position (spec #188). Any other is a changed layout. */
const HEADER = [
  "Item No.",
  "Datetime",
  "Revenues/Expenses",
  "Transaction ID",
  "Description",
  "Frequency",
  "Amount",
  "Status",
  "Responsible person",
  "Remark",
  "InFolder?",
  "Receipt unmatched",
] as const;

/**
 * One Revenues row. `date` and `amount` are what staff can't fix in the form, so a cell that
 * doesn't parse is kept as `unreadable` and its Invoice is blocked, not dropped.
 */
export interface SheetRow {
  readonly itemNo: string;
  readonly date: CalendarDate | "unreadable";
  /** As written on the sheet; review checks it against `TXN-YYYYMMDD-NNNN` and `date`. */
  readonly transactionId: string;
  readonly description: string;
  readonly amount: HkdCents | "unreadable";
  readonly remark: string;
}

export type CashFlow =
  | { readonly kind: "rows"; readonly rows: readonly SheetRow[] }
  | { readonly kind: "layoutChanged" };

/** The grid `readSheet` gave: the header checked, then the Revenues rows. Status is ignored. */
export function parseCashFlow(grid: readonly string[][]): CashFlow {
  const [header, ...rows] = grid;
  if (
    header?.length !== HEADER.length ||
    header.some((name, i) => name.trim() !== HEADER[i])
  )
    return { kind: "layoutChanged" };
  return {
    kind: "rows",
    rows: rows
      .map(
        (cells) =>
          (i: number): string =>
            (cells[i] ?? "").trim(),
      ) // a short row ends in blanks: Google omits trailing empty cells (ValueRange docs, at ValueRange above)
      .filter((cell) => cell(2) === "Revenues")
      .map((cell) => ({
        itemNo: cell(0),
        date: sheetDate(cell(1)),
        transactionId: cell(3),
        description: cell(4),
        amount: sheetAmount(cell(6)),
        remark: cell(9),
      })),
  };
}

/** `D/M/YYYY`, no zero padding, as a calendar date. */
function sheetDate(text: string): CalendarDate | "unreadable" {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match === null) return "unreadable";
  const [, d = "", m = "", y = ""] = match;
  const date = CalendarDate.safeParse(
    `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
  );
  return date.success ? date.data : "unreadable";
}

/** `HKD$1,234.50` as cents above 0. */
function sheetAmount(text: string): HkdCents | "unreadable" {
  if (!text.startsWith("HKD$")) return "unreadable";
  const amount = parseAmount(text.slice("HKD$".length));
  return amount === "invalid" ? "unreadable" : amount;
}
