// What the Plugin needs to reach the Cash Flow Sheet, checked at the boundary: the service-account
// key (a Plugin Secret) and the sheet's ID, parsed out of the link staff paste. The ID never lives
// in the repo, which is public. Nothing here logs: the key is a secret.

import { z } from "zod";

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
