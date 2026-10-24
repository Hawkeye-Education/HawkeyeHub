import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginId } from "@hawkeye-hub/plugin-format";
import { beforeEach, expect, test } from "vitest";
import { loadAssistantModels, saveAssistantModels } from "./assistant-models";
import type { HubEvent } from "./diagnostics";
import {
  parseAbsolutePath,
  parseAiProviderLabel,
  parseModelId,
  type AbsolutePath,
} from "./ids";

let dataDir: AbsolutePath;

const unexpected = (event: HubEvent): never => {
  throw new Error(`Unexpected hub.log event ${event.kind}`);
};

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "assistant-models-")));
});

const file = () => join(dataDir, "assistant-models.json");

test("a missing file is every Plugin on Default", () => {
  expect(loadAssistantModels(dataDir, unexpected)).toEqual(new Map());
});

test("the choices round-trip as Plugin id to choice", () => {
  const models = new Map([
    [
      PluginId.parse("regex-helper"),
      {
        kind: "chosen" as const,
        provider: parseAiProviderLabel("Local"),
        model: parseModelId("big-model"),
      },
    ],
    [PluginId.parse("class-timer"), { kind: "default" as const }],
  ]);
  saveAssistantModels(dataDir, models);
  expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
    "regex-helper": { kind: "chosen", provider: "Local", model: "big-model" },
    "class-timer": { kind: "default" },
  });
  expect(loadAssistantModels(dataDir, unexpected)).toEqual(models);
});

test.each([
  ["not JSON", "{"],
  ["an unknown kind", '{"regex-helper":{"kind":"best"}}'],
  ["an unknown field", '{"regex-helper":{"kind":"default","x":1}}'],
  ["a bad Plugin id", '{"Regex Helper":{"kind":"default"}}'],
])(
  "a file with %s is every Plugin on Default, and says so in hub.log",
  (_, contents) => {
    writeFileSync(file(), contents);
    const events: HubEvent[] = [];
    expect(loadAssistantModels(dataDir, (event) => events.push(event))).toEqual(
      new Map(),
    );
    expect(events).toEqual([{ kind: "assistant-models-unreadable" }]);
  },
);
