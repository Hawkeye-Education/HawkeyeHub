// Plugin Data (PLUGIN_STANDARD.md §4.8): the last folders and pattern, in the Plugin's own
// localStorage, versioned and migrated forward at open.

import type { FolderPath } from "@hawkeye-hub/hub-api";
import { z } from "zod";

const Folder = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("chosen"),
    // Saved from a `<hub-folder-field>`'s value in this Plugin's own Plugin Data, so the Hub made
    // it; a brand is granted only by a cast. A folder gone since is the Backend's `folder-missing`.
    path: z.string().transform((path) => path as FolderPath),
  }),
]);
const V1 = z.strictObject({
  v: z.literal(1),
  input: Folder,
  output: Folder,
  pattern: z.string(),
  regex: z.boolean(),
  ignoreCase: z.boolean(),
});
const Stored = z.discriminatedUnion("v", [V1]);
/** Always the newest version. */
export type Settings = z.infer<typeof V1>;

const KEY = "settings";
const FIRST_OPEN: Settings = {
  v: 1,
  input: { kind: "none" },
  output: { kind: "none" },
  pattern: "",
  regex: false,
  ignoreCase: true,
};

/** The first open's settings when none are stored; throws on corrupt ones. */
export function loadSettings(): Settings {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return FIRST_OPEN;
  return migrate(Stored.parse(JSON.parse(raw)));
}

function migrate(stored: z.infer<typeof Stored>): Settings {
  // V1 is the only version so far. When V2 lands, switch on `stored.v`:
  // case 1: return migrate(v1ToV2(stored)); case 2: return stored.
  return stored;
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
