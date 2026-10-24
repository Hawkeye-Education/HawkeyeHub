// An Assistant's system prompt (ADRs 0001, 0004, 0010): the Hub preamble, then the Plugin's
// `agents/assistant.md`, then every Skill in `agents/skills/`, read whole: its `SKILL.md`, then
// every other file in its folder (`references/`, text `assets/`), however deep. Packaging refuses
// `scripts/` and anything not text. Only `agents/` is read: nothing else in the Plugin ever reaches
// a model.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { DisplayLanguage } from "../shared/hub-chrome-ipc";
import { parseAbsolutePath, type AbsolutePath } from "./ids";

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

function under(folder: AbsolutePath, ...names: string[]): AbsolutePath {
  return parseAbsolutePath(join(folder, ...names));
}

function read(file: AbsolutePath): string {
  return readFileSync(file, "utf8");
}

/**
 * Every file in a Skill's folder but `SKILL.md`, at any depth. Sorted by their path with `/`
 * between folders, so the context reads the same on every computer and OS.
 */
function otherFilesOf(skill: AbsolutePath): AbsolutePath[] {
  return readdirSync(skill, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => under(parseAbsolutePath(entry.parentPath), entry.name))
    .map((file) => ({ file, path: relative(skill, file).split(sep).join("/") }))
    .filter(({ path }) => path !== "SKILL.md")
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ file }) => file);
}

/** Throws if `agents/assistant.md`, `agents/skills/` or a Skill's `SKILL.md` is missing. */
export function assistantContext(
  pluginFolder: AbsolutePath,
  language: DisplayLanguage,
): string {
  const agents = under(pluginFolder, "agents");
  const skills = under(agents, "skills");
  const skillFolders = readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort()
    .map((name) => under(skills, name));
  return [
    preamble(language),
    read(under(agents, "assistant.md")),
    ...skillFolders.flatMap((skill) => [
      read(under(skill, "SKILL.md")),
      ...otherFilesOf(skill).map(read),
    ]),
  ].join("\n\n");
}
