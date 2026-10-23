import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import {
  loadDevPlugins,
  loadInstalledPlugins,
  sweepLeftovers,
  writeRecord as writeInstalledRecord,
} from "./installed-plugins";
import { PluginId, PluginVersion } from "@hawkeye-hub/plugin-format";

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

// Dev mode's Plugins are `<pluginsDir>/<id>` folders, here the data folder.

test("each dev Plugin loads its folder and Manifest, and no record is read or written", () => {
  writeManifest(
    "seating-plan",
    JSON.stringify(manifest("seating-plan", "1.2.0")),
  );
  writeManifest(
    "class-timer",
    JSON.stringify(manifest("class-timer", "0.1.0")),
  );

  expect(
    loadDevPlugins(dataDir, [
      PluginId.parse("seating-plan"),
      PluginId.parse("class-timer"),
    ]),
  ).toEqual([
    {
      folder: join(dataDir, "seating-plan"),
      manifest: manifest("seating-plan", "1.2.0"),
    },
    {
      folder: join(dataDir, "class-timer"),
      manifest: manifest("class-timer", "0.1.0"),
    },
  ]);
  expect(existsSync(join(dataDir, "installed-plugins.json"))).toBe(false);
});

test.each([
  ["folder is missing", null, "folder-missing"],
  ["Manifest is invalid", "{", "manifest-invalid"],
  [
    "Manifest names another id",
    JSON.stringify(manifest("class-timer", "1.2.0")),
    "manifest-disagrees",
  ],
])("a dev Plugin whose %s throws with why", (_, json, reason) => {
  if (json !== null) writeManifest("seating-plan", json);

  expect(() =>
    loadDevPlugins(dataDir, [PluginId.parse("seating-plan")]),
  ).toThrow(
    `Plugin "seating-plan" (${join(dataDir, "seating-plan")}): ${reason}`,
  );
});

// The launch sweep and the record's write (spec #91).

test("the sweep deletes every .partial folder, .download file and version the record does not name, and nothing else", () => {
  install("seating-plan", "1.2.0");
  install("seating-plan", "1.1.0");
  install("class-timer", "0.1.0");
  mkdirSync(join(dataDir, "seating-plan@1.3.0.partial"));
  writeFileSync(join(dataDir, "attendance@2.0.0.download"), "zip");
  mkdirSync(join(dataDir, "plugin-data"));
  mkdirSync(join(dataDir, "stores"));
  mkdirSync(join(dataDir, "not@a version"));
  writeRecord(JSON.stringify([{ id: "seating-plan", version: "1.2.0" }]));

  const swept = sweepLeftovers(dataDir).map(
    ({ plugin, partial }) =>
      `${plugin.id}@${plugin.version}${partial ? " partial" : ""}`,
  );

  expect(swept.sort()).toEqual([
    "attendance@2.0.0 partial",
    "class-timer@0.1.0",
    "seating-plan@1.1.0",
    "seating-plan@1.3.0 partial",
  ]);
  expect(readdirSync(dataDir).sort()).toEqual([
    "installed-plugins.json",
    "not@a version",
    "plugin-data",
    "seating-plan@1.2.0",
    "stores",
  ]);
});

test("the sweep on a fresh Hub writes the empty record and deletes nothing", () => {
  expect(sweepLeftovers(dataDir)).toEqual([]);
  expect(readdirSync(dataDir)).toEqual(["installed-plugins.json"]);
});

test("the record is replaced whole, leaving no temp file", () => {
  writeRecord(JSON.stringify([{ id: "seating-plan", version: "1.2.0" }]));

  writeInstalledRecord(dataDir, [
    {
      id: PluginId.parse("class-timer"),
      version: PluginVersion.parse("0.1.0"),
    },
  ]);

  expect(
    JSON.parse(readFileSync(join(dataDir, "installed-plugins.json"), "utf8")),
  ).toEqual([{ id: "class-timer", version: "0.1.0" }]);
  expect(readdirSync(dataDir)).toEqual(["installed-plugins.json"]);
});
