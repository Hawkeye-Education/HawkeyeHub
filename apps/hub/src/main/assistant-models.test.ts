import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginId } from "@hawkeye-hub/plugin-format";
import { beforeEach, expect, test } from "vitest";
import { loadAssistantModels, saveAssistantModels } from "./assistant-models";
import {
  parseAbsolutePath,
  parseAiProviderLabel,
  type AbsolutePath,
} from "./ids";

let dataDir: AbsolutePath;

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "assistant-models-")));
});

const file = () => join(dataDir, "assistant-models.json");

test("a missing file is every Plugin on Default", () => {
  expect(loadAssistantModels(dataDir)).toEqual(new Map());
});

test("the choices round-trip as Plugin id to choice", () => {
  const models = new Map([
    [
      PluginId.parse("regex-helper"),
      {
        kind: "chosen" as const,
        provider: parseAiProviderLabel("Local"),
        model: "big-model",
      },
    ],
    [PluginId.parse("class-timer"), { kind: "default" as const }],
  ]);
  saveAssistantModels(dataDir, models);
  expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
    "regex-helper": { kind: "chosen", provider: "Local", model: "big-model" },
    "class-timer": { kind: "default" },
  });
  expect(loadAssistantModels(dataDir)).toEqual(models);
});

test.each([
  ["not JSON", "{"],
  ["an unknown kind", '{"regex-helper":{"kind":"best"}}'],
  ["an unknown field", '{"regex-helper":{"kind":"default","x":1}}'],
  ["a bad Plugin id", '{"Regex Helper":{"kind":"default"}}'],
])("a file with %s throws", (_, contents) => {
  writeFileSync(file(), contents);
  expect(() => loadAssistantModels(dataDir)).toThrow();
});
