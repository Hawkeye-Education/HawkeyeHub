import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import type { HubSettings } from "../shared/hub-chrome-ipc";
import { HubSettingsSchema } from "../shared/hub-settings";
import { openDiagnostics, type Diagnostics } from "./diagnostics";
import { loadHubSettings, saveHubSettings } from "./hub-settings";
import { parseAbsolutePath, type AbsolutePath } from "./ids";

const FIRST_LAUNCH = {
  theme: { kind: "company" },
  colourScheme: "system",
  displayLanguage: { kind: "system" },
  aiProviders: [],
  defaultAiProvider: { kind: "none" },
  favourites: [],
  switcherCollapsed: false,
};

let dataDir: AbsolutePath;
let logsDir: AbsolutePath;
let diagnostics: Diagnostics;

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-settings-")));
  logsDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-logs-")));
  diagnostics = openDiagnostics(logsDir, () => new Date());
});

function writeSettings(contents: string): void {
  writeFileSync(join(dataDir, "hub-settings.json"), contents);
}

function settingsOnDisk(): unknown {
  return JSON.parse(readFileSync(join(dataDir, "hub-settings.json"), "utf8"));
}

test("a missing file is written with the first-launch values", () => {
  expect(loadHubSettings(dataDir, diagnostics)).toEqual(FIRST_LAUNCH);
  expect(settingsOnDisk()).toEqual(FIRST_LAUNCH);
});

const CHOSEN = {
  theme: { kind: "chosen", name: "harbour" },
  colourScheme: "dark",
  displayLanguage: { kind: "chosen", language: "zh-HK" },
  aiProviders: [],
  defaultAiProvider: { kind: "none" },
  favourites: ["class-timer"],
  switcherCollapsed: true,
};

test("a valid file is returned as it is, with nothing logged", () => {
  writeSettings(JSON.stringify(CHOSEN));
  expect(loadHubSettings(dataDir, diagnostics)).toEqual(CHOSEN);
  expect(settingsOnDisk()).toEqual(CHOSEN);
  expect(existsSync(join(logsDir, "hub.log"))).toBe(false);
});

test("a file from before Favourites reads as having none, with nothing logged", () => {
  const { favourites: _, ...withoutFavourites } = CHOSEN;
  writeSettings(JSON.stringify(withoutFavourites));
  expect(loadHubSettings(dataDir, diagnostics)).toEqual({
    ...CHOSEN,
    favourites: [],
  });
  expect(existsSync(join(logsDir, "hub.log"))).toBe(false);
});

test("a file from before the icon rail reads as an expanded Switcher, with nothing logged", () => {
  const { switcherCollapsed: _, ...withoutCollapse } = CHOSEN;
  writeSettings(JSON.stringify(withoutCollapse));
  expect(loadHubSettings(dataDir, diagnostics)).toEqual({
    ...CHOSEN,
    switcherCollapsed: false,
  });
  expect(existsSync(join(logsDir, "hub.log"))).toBe(false);
});

test("a Favourite that is not a Plugin id is refused", () => {
  expect(
    HubSettingsSchema.safeParse({ ...CHOSEN, favourites: ["Not An Id"] })
      .success,
  ).toBe(false);
});

function hubLogMessages(): unknown[] {
  return readFileSync(join(logsDir, "hub.log"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const { level, message } = JSON.parse(line) as Record<string, unknown>;
      return { level, message };
    });
}

test.each([
  ["that is not JSON", "{ colourScheme: dark", "not JSON"],
  [
    "with a value the schema refuses",
    JSON.stringify({ ...CHOSEN, colourScheme: "sepia" }),
    "invalid",
  ],
  [
    "with a field this Hub does not know",
    JSON.stringify({ ...CHOSEN, fontSize: 14 }),
    "invalid",
  ],
  [
    "missing a field",
    JSON.stringify({ theme: CHOSEN.theme, colourScheme: "dark" }),
    "invalid",
  ],
])(
  "a file %s is logged and replaced with the first-launch values",
  (_, contents, problem) => {
    writeSettings(contents);
    expect(loadHubSettings(dataDir, diagnostics)).toEqual(FIRST_LAUNCH);
    expect(settingsOnDisk()).toEqual(FIRST_LAUNCH);
    expect(hubLogMessages()).toEqual([
      {
        level: "warn",
        message: `Hub Settings replaced with first-launch values: ${problem}`,
      },
    ]);
  },
);

test("a settings path that is a folder is logged, and the Hub starts with the first-launch values", () => {
  mkdirSync(join(dataDir, "hub-settings.json"));
  expect(loadHubSettings(dataDir, diagnostics)).toEqual(FIRST_LAUNCH);
  expect(hubLogMessages()).toEqual([
    {
      level: "warn",
      message: "Hub Settings replaced with first-launch values: unreadable",
    },
    {
      level: "error",
      // The code renaming onto a folder fails with differs by OS (EISDIR, EPERM).
      message: expect.stringMatching(
        /^Hub Settings could not be written: E[A-Z]+$/,
      ) as unknown,
    },
  ]);
});

test("saved settings load back the same", () => {
  loadHubSettings(dataDir, diagnostics);
  const saved = { ...FIRST_LAUNCH, colourScheme: "light" } as HubSettings;
  saveHubSettings(dataDir, saved);
  expect(loadHubSettings(dataDir, diagnostics)).toEqual(saved);
});

const AZURE = {
  label: "School Azure",
  endpoint: {
    kind: "openai-compatible",
    baseUrl: "https://school.openai.azure.com/openai/v1",
  },
  models: [{ id: "gpt-5", inputs: ["image"] }],
};
const CLAUDE = {
  label: "Claude",
  endpoint: { kind: "anthropic" },
  models: [
    { id: "claude-opus-5-5", inputs: ["image"] },
    { id: "claude-haiku-4-5", inputs: [] },
  ],
};
const WITH_AI = {
  ...CHOSEN,
  aiProviders: [AZURE, CLAUDE],
  defaultAiProvider: {
    kind: "chosen",
    provider: "Claude",
    model: "claude-haiku-4-5",
  },
};

test("a file from before model inputs loads acceptsImages as inputs, and saves the new shape", () => {
  const old = {
    ...WITH_AI,
    aiProviders: [
      {
        ...AZURE,
        models: [
          { id: "gpt-5", acceptsImages: true },
          { id: "gpt-5-mini", acceptsImages: false },
        ],
      },
    ],
    defaultAiProvider: { kind: "none" },
  };
  writeSettings(JSON.stringify(old));
  const loaded = loadHubSettings(dataDir, diagnostics);
  const migrated = {
    ...old,
    aiProviders: [
      {
        ...AZURE,
        models: [
          { id: "gpt-5", inputs: ["image"] },
          { id: "gpt-5-mini", inputs: [] },
        ],
      },
    ],
  };
  expect(loaded).toEqual(migrated);
  saveHubSettings(dataDir, loaded);
  expect(settingsOnDisk()).toEqual(migrated);
});

test("AI Providers of both kinds and a Default AI Provider are accepted", () => {
  expect(HubSettingsSchema.parse(WITH_AI)).toEqual(WITH_AI);
});

test.each([
  ["an unknown kind", { ...CLAUDE, endpoint: { kind: "gemini" } }],
  [
    "a Base URL on an Anthropic provider",
    {
      ...CLAUDE,
      endpoint: { kind: "anthropic", baseUrl: "https://example.com" },
    },
  ],
  [
    "an openai-compatible provider with no Base URL",
    { ...CLAUDE, endpoint: { kind: "openai-compatible" } },
  ],
  [
    "a Base URL that is not a URL",
    { ...CLAUDE, endpoint: { kind: "openai-compatible", baseUrl: "school" } },
  ],
  ["a blank label", { ...CLAUDE, label: " " }],
  ["an empty model list", { ...CLAUDE, models: [] }],
  ["a blank model id", { ...CLAUDE, models: [{ id: " ", inputs: [] }] }],
  ["a key", { ...CLAUDE, apiKey: "sk-secret" }],
  [
    "audio on an Anthropic model",
    { ...CLAUDE, models: [{ id: "claude-opus-5-5", inputs: ["audio"] }] },
  ],
  [
    "an input named twice",
    { ...AZURE, models: [{ id: "gpt-5", inputs: ["image", "image"] }] },
  ],
  [
    "an unknown input",
    { ...AZURE, models: [{ id: "gpt-5", inputs: ["video"] }] },
  ],
])("an AI Provider with %s is refused", (_, provider) => {
  const settings = { ...WITH_AI, aiProviders: [AZURE, provider] };
  expect(HubSettingsSchema.safeParse(settings).success).toBe(false);
});

test.each([
  [
    "duplicate labels",
    { ...WITH_AI, aiProviders: [AZURE, { ...CLAUDE, label: AZURE.label }] },
  ],
  [
    "a default naming a missing provider",
    {
      ...WITH_AI,
      defaultAiProvider: { kind: "chosen", provider: "Gone", model: "gpt-5" },
    },
  ],
  [
    "a default naming a model its provider lacks",
    {
      ...WITH_AI,
      defaultAiProvider: { kind: "chosen", provider: "Claude", model: "gpt-5" },
    },
  ],
  ["no Default AI Provider", { ...CHOSEN, defaultAiProvider: undefined }],
])("Hub Settings with %s are refused", (_, settings) => {
  expect(HubSettingsSchema.safeParse(settings).success).toBe(false);
});
