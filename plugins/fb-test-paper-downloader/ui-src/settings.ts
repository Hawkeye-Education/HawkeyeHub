// Plugin Data (PLUGIN_STANDARD.md §4.8): the group, output folder and Update's stop-at-known
// checkbox as staff left them, in the Plugin's own localStorage, versioned so a later shape can
// migrate from it.

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
const Stored = z.strictObject({
  v: z.literal(1),
  // What staff typed: a group URL or a bare id. The Backend parses it (`group-invalid`).
  group: z.string(),
  output: Folder,
  // Update ends its feed scan at posts downloaded before (fb_papers.py's --update).
  stopAtKnown: z.boolean(),
});
export type Settings = z.infer<typeof Stored>;

const KEY = "settings";
const FIRST_OPEN: Settings = {
  v: 1,
  group: "460403882433823",
  output: { kind: "none" },
  stopAtKnown: true,
};

/** The first open's settings when none are stored; throws on corrupt ones. */
export function loadSettings(): Settings {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return FIRST_OPEN;
  return Stored.parse(JSON.parse(raw));
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
