import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { assistantContext } from "./assistant-context";
import { parseAbsolutePath } from "./ids";

function pluginFolder(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "assistant-context-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return parseAbsolutePath(folder);
}

const FIXTURE = {
  "agents/assistant.md": "ASSISTANT PROMPT",
  "agents/skills/drafting-regex/SKILL.md": "SKILL DRAFTING",
  "agents/skills/drafting-regex/references/flags.md": "REFERENCE FLAGS",
  "agents/skills/drafting-regex/references/unicode/classes.md":
    "REFERENCE NESTED",
  "agents/skills/drafting-regex/assets/template.txt": "ASSET TEMPLATE",
  "agents/skills/checking-pages/SKILL.md": "SKILL CHECKING",
  "manifest.json": "OUTSIDE MANIFEST",
  "ui/index.html": "OUTSIDE UI",
  "notes.md": "OUTSIDE NOTES",
};

test("the context is the Hub preamble, then assistant.md, then every Skill whole: SKILL.md, then every other file by path", () => {
  const context = assistantContext(pluginFolder(FIXTURE))("en-HK");
  const order = [
    "You advise",
    "ASSISTANT PROMPT",
    "SKILL CHECKING",
    "SKILL DRAFTING",
    "ASSET TEMPLATE",
    "REFERENCE FLAGS",
    "REFERENCE NESTED",
  ].map((text) => context.indexOf(text));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("the preamble asks for Markdown in the Display Language", () => {
  const folder = pluginFolder(FIXTURE);
  expect(assistantContext(folder)("en-HK")).toMatch(
    /Markdown.*English \(Hong Kong\)/s,
  );
  expect(assistantContext(folder)("zh-HK")).toMatch(
    /Markdown.*Traditional Chinese \(Hong Kong\)/s,
  );
});

test("nothing outside agents/ is read", () => {
  expect(assistantContext(pluginFolder(FIXTURE))("en-HK")).not.toContain(
    "OUTSIDE",
  );
});
