// An Assistant's system prompt (ADRs 0001, 0004, 0010): the Hub preamble, then the Plugin's
// `agents/assistant.md`, then every `agents/skills/*/SKILL.md` with its references, read whole.
// Only `agents/` is read: nothing else in the Plugin ever reaches a model.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DisplayLanguage } from "../shared/hub-chrome-ipc";
import type { AbsolutePath } from "./ids";

const LANGUAGE_NAMES = {
  "en-HK": "English (Hong Kong)",
  "zh-HK": "Traditional Chinese (Hong Kong)",
} satisfies Record<DisplayLanguage, string>;

function preamble(language: DisplayLanguage): string {
  return [
    "You advise a member of staff who is using this Plugin of Hawkeye Hub.",
    "You cannot act: you cannot run the Plugin, change its settings or see their files. You know only what follows and what they tell you in this conversation.",
    `Answer in Markdown, in ${LANGUAGE_NAMES[language]}.`,
  ].join("\n");
}

/** Sorted by name, so the context reads the same on every computer. */
function namesIn(folder: string, kind: "files" | "folders"): string[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) =>
      kind === "files" ? entry.isFile() : entry.isDirectory(),
    )
    .map(({ name }) => name)
    .sort();
}

function referencesOf(skill: string): string[] {
  const references = join(skill, "references");
  // A Skill may have no references (ADR 0004).
  const names = readdirSync(skill).includes("references")
    ? namesIn(references, "files")
    : [];
  return names.map((name) => readFileSync(join(references, name), "utf8"));
}

/** Throws if `agents/assistant.md` or `agents/skills/` is missing. */
export function assistantContext(
  pluginFolder: AbsolutePath,
  language: DisplayLanguage,
): string {
  const agents = join(pluginFolder, "agents");
  const skills = join(agents, "skills");
  return [
    preamble(language),
    readFileSync(join(agents, "assistant.md"), "utf8"),
    ...namesIn(skills, "folders").flatMap((name) => [
      readFileSync(join(skills, name, "SKILL.md"), "utf8"),
      ...referencesOf(join(skills, name)),
    ]),
  ].join("\n\n");
}
