import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import { loadInstalledPlugins } from "./installed-plugins";

let dataDir: AbsolutePath;

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-installed-")));
});

function manifest(id: string, version: string): Record<string, unknown> {
  return {
    id,
    version,
    hubApi: "^1.0.0",
    name: { "en-HK": "Seating Plan", "zh-HK": "座位表" },
    description: "Plan where students sit.",
    platforms: ["win32-x64", "darwin-arm64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "none" },
    assistant: { kind: "none" },
  };
}

function writeRecord(contents: string): void {
  writeFileSync(join(dataDir, "installed-plugins.json"), contents);
}

/** Writes `<id>@<version>/manifest.json`, holding `json` as given. */
function writeManifest(folder: string, json: string): void {
  mkdirSync(join(dataDir, folder));
  writeFileSync(join(dataDir, folder, "manifest.json"), json);
}

function install(id: string, version: string): void {
  writeManifest(`${id}@${version}`, JSON.stringify(manifest(id, version)));
}

test("an absent record is written as an empty array and no Plugins load", () => {
  expect(loadInstalledPlugins(dataDir)).toEqual({ loaded: [], leftOut: [] });
  expect(
    JSON.parse(readFileSync(join(dataDir, "installed-plugins.json"), "utf8")),
  ).toEqual([]);
});

test("an empty record loads no Plugins", () => {
  writeRecord("[]");

  expect(loadInstalledPlugins(dataDir)).toEqual({ loaded: [], leftOut: [] });
});

test("each entry loads its version's folder and Manifest", () => {
  install("seating-plan", "1.2.0");
  install("class-timer", "0.1.0");
  writeRecord(
    JSON.stringify([
      { id: "seating-plan", version: "1.2.0" },
      { id: "class-timer", version: "0.1.0" },
    ]),
  );

  expect(loadInstalledPlugins(dataDir)).toEqual({
    loaded: [
      {
        folder: join(dataDir, "seating-plan@1.2.0"),
        manifest: manifest("seating-plan", "1.2.0"),
      },
      {
        folder: join(dataDir, "class-timer@0.1.0"),
        manifest: manifest("class-timer", "0.1.0"),
      },
    ],
    leftOut: [],
  });
});

test.each([
  ["is not JSON", "[{"],
  ["is not an array", "{}"],
  ["has an entry with an extra key", '[{"id":"a","version":"1.0.0","x":1}]'],
  ["has an entry with a bad id", '[{"id":"Not An Id","version":"1.0.0"}]'],
  ["has an entry with a bad version", '[{"id":"a","version":"1.0"}]'],
  [
    "has duplicate ids",
    '[{"id":"a","version":"1.0.0"},{"id":"a","version":"2.0.0"}]',
  ],
])("a record that %s throws", (_, contents) => {
  writeRecord(contents);

  expect(() => loadInstalledPlugins(dataDir)).toThrow();
});

test("an entry whose folder is missing is left out, and the rest load", () => {
  install("class-timer", "0.1.0");
  writeRecord(
    JSON.stringify([
      { id: "seating-plan", version: "1.2.0" },
      { id: "class-timer", version: "0.1.0" },
    ]),
  );

  expect(loadInstalledPlugins(dataDir)).toEqual({
    loaded: [
      {
        folder: join(dataDir, "class-timer@0.1.0"),
        manifest: manifest("class-timer", "0.1.0"),
      },
    ],
    leftOut: [
      {
        plugin: { id: "seating-plan", version: "1.2.0" },
        reason: "folder-missing",
      },
    ],
  });
});

test.each([
  ["is missing", null],
  ["is not JSON", "{"],
  ["does not parse as a Manifest", JSON.stringify({ id: "seating-plan" })],
])("an entry whose Manifest %s is left out as invalid", (_, json) => {
  if (json === null) {
    mkdirSync(join(dataDir, "seating-plan@1.2.0"));
  } else {
    writeManifest("seating-plan@1.2.0", json);
  }
  writeRecord(JSON.stringify([{ id: "seating-plan", version: "1.2.0" }]));

  expect(loadInstalledPlugins(dataDir)).toEqual({
    loaded: [],
    leftOut: [
      {
        plugin: { id: "seating-plan", version: "1.2.0" },
        reason: "manifest-invalid",
      },
    ],
  });
});

test.each([
  ["id", manifest("class-timer", "1.2.0")],
  ["version", manifest("seating-plan", "1.3.0")],
])("an entry whose Manifest %s disagrees is left out", (_, disagreeing) => {
  writeManifest("seating-plan@1.2.0", JSON.stringify(disagreeing));
  writeRecord(JSON.stringify([{ id: "seating-plan", version: "1.2.0" }]));

  expect(loadInstalledPlugins(dataDir)).toEqual({
    loaded: [],
    leftOut: [
      {
        plugin: { id: "seating-plan", version: "1.2.0" },
        reason: "manifest-disagrees",
      },
    ],
  });
});

test("a present record is never rewritten", () => {
  writeRecord("[ ]");

  loadInstalledPlugins(dataDir);

  expect(readFileSync(join(dataDir, "installed-plugins.json"), "utf8")).toBe(
    "[ ]",
  );
});
