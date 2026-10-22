import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, type PluginId } from "@hawkeye-hub/plugin-format";
import { beforeEach, expect, test } from "vitest";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import { versionFolder, type InstalledPlugin } from "./installed-plugins";
import { uninstallPlugin } from "./plugin-uninstall";

let dataDir: AbsolutePath;
let cleared: PluginId[];

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-uninstall-")));
  cleared = [];
});

const deps = () => ({
  dataDir,
  clearPartition: (id: PluginId) => {
    cleared.push(id);
    return Promise.resolve();
  },
});

/**
 * Puts Plugin `id` on disk as an install leaves it: its version folder, its record entry, its
 * Plugin Data folder and its stores' folders, each holding a file.
 */
function installedOnDisk(id: string, stores: string[]): InstalledPlugin {
  const parsed = parseManifest({
    id,
    version: "1.0.0",
    hubApi: "^1.0.0",
    name: id,
    description: "A fixture.",
    platforms: ["win32-x64"],
    identity: { kind: "none" },
    stores,
    backend: { kind: "none" },
    assistant: { kind: "none" },
  });
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  const { manifest } = parsed;
  const folder = versionFolder(dataDir, manifest);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "manifest.json"), JSON.stringify(manifest));
  const recordPath = join(dataDir, "installed-plugins.json");
  const entries: unknown[] = existsSync(recordPath)
    ? (JSON.parse(readFileSync(recordPath, "utf8")) as unknown[])
    : [];
  writeFileSync(
    recordPath,
    JSON.stringify([...entries, { id, version: "1.0.0" }]),
  );
  for (const dir of [
    join(dataDir, "plugin-data", id),
    ...stores.map((store) => join(dataDir, "stores", store)),
  ]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "kept.txt"), "x");
  }
  return { folder, manifest };
}

function record(): unknown {
  return JSON.parse(
    readFileSync(join(dataDir, "installed-plugins.json"), "utf8"),
  );
}

const there = (...path: string[]) => existsSync(join(dataDir, ...path));

test("keeping data removes the record entry and the version folder, and leaves the data, stores and partition", async () => {
  installedOnDisk("class-timer", []);
  const plugin = installedOnDisk("seating-plan", ["rooms"]);

  await uninstallPlugin(deps(), plugin, "keep-data");

  expect(record()).toEqual([{ id: "class-timer", version: "1.0.0" }]);
  expect(there("seating-plan@1.0.0")).toBe(false);
  expect(there("class-timer@1.0.0")).toBe(true);
  expect(there("plugin-data", "seating-plan", "kept.txt")).toBe(true);
  expect(there("stores", "rooms", "kept.txt")).toBe(true);
  expect(cleared).toEqual([]);
});

test("deleting data also clears the partition, the Plugin Data and every store no other installed Plugin declares", async () => {
  installedOnDisk("class-timer", ["timetable"]);
  const plugin = installedOnDisk("seating-plan", ["rooms", "timetable"]);

  await uninstallPlugin(deps(), plugin, "delete-data");

  expect(record()).toEqual([{ id: "class-timer", version: "1.0.0" }]);
  expect(there("seating-plan@1.0.0")).toBe(false);
  expect(cleared).toEqual(["seating-plan"]);
  expect(there("plugin-data", "seating-plan")).toBe(false);
  expect(there("stores", "rooms")).toBe(false);
  expect(there("stores", "timetable", "kept.txt")).toBe(true);
  expect(there("plugin-data", "class-timer", "kept.txt")).toBe(true);
});
