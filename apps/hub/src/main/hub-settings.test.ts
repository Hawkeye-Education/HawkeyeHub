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
import { openDiagnostics, type Diagnostics } from "./diagnostics";
import { loadHubSettings, saveHubSettings } from "./hub-settings";
import { parseAbsolutePath, type AbsolutePath } from "./ids";

const FIRST_LAUNCH = {
  theme: { kind: "company" },
  colourScheme: "system",
  displayLanguage: { kind: "system" },
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
};

test("a valid file is returned as it is, with nothing logged", () => {
  writeSettings(JSON.stringify(CHOSEN));
  expect(loadHubSettings(dataDir, diagnostics)).toEqual(CHOSEN);
  expect(settingsOnDisk()).toEqual(CHOSEN);
  expect(existsSync(join(logsDir, "hub.log"))).toBe(false);
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
