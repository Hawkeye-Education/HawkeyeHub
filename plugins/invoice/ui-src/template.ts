// The Official Receipt template: the placeholders it must carry, the check an imported file must
// pass, and its bytes kept in IndexedDB (Plugin Data, PLUGIN_STANDARD.md §4.8). Nothing here logs:
// a template is company stationery.

import { patchDetector } from "docx";
import { z } from "zod";

/** Every placeholder a template must have, and the only ones it may have. */
export const PLACEHOLDERS = [
  "invoice_no",
  "date",
  "received_from",
  "student_name",
  "item_description",
  "item_amount",
  "total",
  "amount_in_words",
  "pay_cash",
  "pay_bank_transfer",
  "pay_fps",
  "pay_cheque",
  "pay_other",
  "pay_other_text",
  "remarks",
  "received_by",
] as const;

/** A template staff imported: the file's name, to show in Settings, and its bytes. */
export interface Template {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export type TemplateCheck =
  | { kind: "valid" }
  | { kind: "not-docx" }
  | {
      kind: "placeholders";
      missing: readonly string[];
      unknown: readonly string[];
    };

/** Whether `bytes` is a `.docx` that opens and carries exactly the PLACEHOLDERS. */
export async function checkTemplate(bytes: Uint8Array): Promise<TemplateCheck> {
  let found: readonly string[];
  try {
    // The same scan patchDocument fills by, so a placeholder Word split across runs counts as it will fill.
    found = await patchDetector({ data: bytes });
  } catch {
    // Not a zip, or a zip that isn't a Word document: staff picked the wrong file.
    return { kind: "not-docx" };
  }
  const known: readonly string[] = PLACEHOLDERS;
  const missing = known.filter((name) => !found.includes(name));
  const unknown = [...new Set(found)].filter((name) => !known.includes(name));
  return missing.length === 0 && unknown.length === 0
    ? { kind: "valid" }
    : { kind: "placeholders", missing, unknown };
}

const DB = "invoice";
const STORE = "template";
const KEY = "current";
const V1 = z.strictObject({
  v: z.literal(1),
  name: z.string(),
  bytes: z.instanceof(Uint8Array),
});
const Stored = z.discriminatedUnion("v", [V1]);

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IndexedDB request failed"));
    };
  });
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(STORE);
  };
  const db = await request(open);
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** The template staff imported, or none before the first import. */
export type StoredTemplate =
  { kind: "none" } | { kind: "imported"; template: Template };

/** The imported template, or none before the first import; throws on a corrupt record. */
export async function loadTemplate(): Promise<StoredTemplate> {
  const raw: unknown = await request((await store("readonly")).get(KEY));
  if (raw === undefined) return { kind: "none" };
  // Only v1 exists. When V2 lands, add it to Stored and migrate forward here, by `v`.
  const stored = Stored.parse(raw);
  return {
    kind: "imported",
    template: { name: stored.name, bytes: stored.bytes },
  };
}

/** Replaces the stored template outright: there is no history. */
export async function saveTemplate(template: Template): Promise<void> {
  await request(
    (await store("readwrite")).put(
      { v: 1, name: template.name, bytes: template.bytes },
      KEY,
    ),
  );
}
