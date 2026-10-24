// Each Plugin's Assistant model (spec #101 story 21): `assistant-models.json` in the Hub's data
// folder, Plugin id → Default or a chosen provider and model. The Panel's picker writes it at once,
// outside Hub Settings' Save and Cancel.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PluginId } from "@hawkeye-hub/plugin-format";
import { z } from "zod";
import { AiModelChoiceSchema, type AiModelChoice } from "../shared/ai-call";
import type { HubEvent } from "./diagnostics";
import { errorCode } from "./error-code";
import type { AbsolutePath } from "./ids";

export const ASSISTANT_MODELS_FILE = "assistant-models.json";

/** A Plugin missing from the map is on Default. */
export type AssistantModels = ReadonlyMap<PluginId, AiModelChoice>;

const FileSchema = z.record(PluginId, AiModelChoiceSchema);

/**
 * The stored choices. A missing file is none. A damaged one is none too, every Plugin on Default,
 * recorded once in hub.log without its contents (ADR 0012), as the key store does.
 */
export function loadAssistantModels(
  dataDir: AbsolutePath,
  recordHubEvent: (event: HubEvent) => void,
): AssistantModels {
  let text: string;
  try {
    text = readFileSync(join(dataDir, ASSISTANT_MODELS_FILE), "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return new Map();
    throw error;
  }
  let parsed: z.infer<typeof FileSchema>;
  try {
    parsed = FileSchema.parse(JSON.parse(text));
  } catch {
    recordHubEvent({ kind: "assistant-models-unreadable" });
    return new Map();
  }
  // Object.entries widens the branded key back to string; the schema checked each one.
  return new Map(
    Object.entries(parsed).map(([id, choice]) => [PluginId.parse(id), choice]),
  );
}

/** Writes every choice, through a temporary file as `saveHubSettings` does. */
export function saveAssistantModels(
  dataDir: AbsolutePath,
  models: AssistantModels,
): void {
  const path = join(dataDir, ASSISTANT_MODELS_FILE);
  writeFileSync(
    `${path}.tmp`,
    `${JSON.stringify(Object.fromEntries(models), null, 2)}\n`,
  );
  renameSync(`${path}.tmp`, path);
}
