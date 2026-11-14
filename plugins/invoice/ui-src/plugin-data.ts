// Plugin Data (PLUGIN_STANDARD.md §4.8): the Plugin's own record in localStorage, versioned and
// parsed with zod at open. The template's bytes live apart, in IndexedDB (template.ts), and the
// key in hub.secrets.

import type { FolderPath } from "@hawkeye-hub/hub-api";
import { z } from "zod";
import { SheetId } from "./google";

const V1 = z.strictObject({
  v: z.literal(1),
  sheet: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("set"), id: SheetId }),
  ]),
  folder: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({
      kind: z.literal("chosen"),
      // Saved from a `<hub-folder-field>`'s value, so the Hub made it; a brand is granted only by a cast.
      path: z.string().transform((path) => path as FolderPath),
    }),
  ]),
  /** The Received by name staff last typed, pre-filled on the next Invoice. */
  receivedBy: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("set"), name: z.string().min(1) }),
  ]),
  /** The Invoice Nos. whose file was written, or met `exists`, from this machine. */
  invoiced: z.array(z.string()),
});
const Stored = z.discriminatedUnion("v", [V1]);
export type PluginData = z.infer<typeof V1>; // always the newest version

const KEY = "invoice";
const FIRST_OPEN: PluginData = {
  v: 1,
  sheet: { kind: "none" },
  folder: { kind: "none" },
  receivedBy: { kind: "none" },
  invoiced: [],
};

/** The first open's record when none is stored; throws on a corrupt one. */
export function loadPluginData(): PluginData {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return FIRST_OPEN;
  // Only v1 exists. When V2 lands, add it to Stored and migrate forward here, by `v`.
  return Stored.parse(JSON.parse(raw));
}

export function savePluginData(data: PluginData): void {
  localStorage.setItem(KEY, JSON.stringify(data));
}
