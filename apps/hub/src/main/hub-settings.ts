// The Hub Settings file: `hub-settings.json` in the Hub's data folder, belonging to the OS user
// (spec #71). Startup guarantees it exists and is valid; Save writes it whole.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HubSettingsSchema, type HubSettings } from "../shared/hub-settings";
import type { Diagnostics, HubSettingsProblem } from "./diagnostics";
import { errorCode } from "./error-code";
import type { AbsolutePath } from "./ids";

export const SETTINGS_FILE = "hub-settings.json";

export const FIRST_LAUNCH_SETTINGS: HubSettings = {
  theme: { kind: "company" },
  colourScheme: "system",
  displayLanguage: { kind: "system" },
};

/** Writes the whole file, through a temporary file, so a crash mid-write never leaves half of it. */
export function saveHubSettings(
  dataDir: AbsolutePath,
  settings: HubSettings,
): void {
  const path = join(dataDir, SETTINGS_FILE);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/**
 * The stored Hub Settings. A missing file is written with the first-launch values. One that cannot
 * be read, is not JSON or fails the schema is logged and overwritten with them, so a damaged file
 * never stops the Hub starting.
 */
export function loadHubSettings(
  dataDir: AbsolutePath,
  diagnostics: Diagnostics,
): HubSettings {
  const read = readSettings(join(dataDir, SETTINGS_FILE));
  if (read.kind === "read") return read.settings;
  if (read.kind === "damaged") {
    diagnostics.recordHubEvent({
      kind: "hub-settings-replaced",
      problem: read.problem,
    });
  }
  // A file that cannot be replaced (its path is a folder, say) is logged, not thrown: the Hub still
  // starts with the first-launch values, and the next Save tries again (story 40).
  try {
    saveHubSettings(dataDir, FIRST_LAUNCH_SETTINGS);
  } catch (error) {
    const code = errorCode(error);
    if (code === undefined) throw error;
    diagnostics.recordHubEvent({ kind: "hub-settings-unwritable", code });
  }
  return FIRST_LAUNCH_SETTINGS;
}

// Each failure is caught only to be logged and replaced by the caller, never swallowed.
function readSettings(
  path: string,
):
  | { kind: "read"; settings: HubSettings }
  | { kind: "missing" }
  | { kind: "damaged"; problem: HubSettingsProblem } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? { kind: "missing" }
      : { kind: "damaged", problem: "unreadable" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // JSON.parse throws only a SyntaxError, for text that is not JSON.
    return { kind: "damaged", problem: "not-json" };
  }
  const parsed = HubSettingsSchema.safeParse(json);
  return parsed.success
    ? { kind: "read", settings: parsed.data }
    : { kind: "damaged", problem: "invalid" };
}
