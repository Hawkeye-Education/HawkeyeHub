import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseManifest,
  PluginId,
  PluginVersion,
} from "@hawkeye-hub/plugin-format";
import { beforeEach, expect, test } from "vitest";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import { versionFolder, type InstalledPlugin } from "./installed-plugins";
import { uninstallPlugin } from "./plugin-uninstall";

let dataDir: AbsolutePath;
let cleared: PluginId[];
let uvRuns: { args: readonly string[]; cwd: string }[];

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-uninstall-")));
  cleared = [];
  uvRuns = [];
});

const deps = () => ({
  dataDir,
  clearPartition: (id: PluginId) => {
    cleared.push(id);
    return Promise.resolve();
  },
  uv: {
    run: (args: readonly string[], cwd: string) => {
      uvRuns.push({ args, cwd });
      return Promise.resolve({ kind: "succeeded" } as const);
    },
  },
});

/** A uv-managed interpreter, as `uv python install` leaves it under the Hub's uv folder. */
function interpreter(key: string): string {
  const dir = join(dataDir, "uv", "python", key);
  mkdirSync(join(dir, "bin"), { recursive: true });
  return dir;
}

/** A venv in `folder`'s Backend on the interpreter whose home is `home`. */
function venvOn(folder: string, home: string): void {
  const venv = join(folder, "backend", ".venv");
  mkdirSync(venv, { recursive: true });
  writeFileSync(
    join(venv, "pyvenv.cfg"),
    `home = ${home}\r\nimplementation = CPython\r\nversion_info = 3.12.7\r\n`,
  );
}

/**
 * Puts Plugin `id` on disk as an install leaves it: its version folder, its record entry, its
 * Plugin Data folder and its stores' folders, each holding a file. A Python Backend's venv is on
 * the interpreter whose home is `pythonHome`.
 */
function installedOnDisk(
  id: string,
  stores: string[],
  pythonHome: string | null = null,
): InstalledPlugin {
  const parsed = parseManifest({
    id,
    version: "1.0.0",
    hubApi: "^1.0.0",
    name: id,
    description: "A fixture.",
    platforms: ["win32-x64"],
    identity: { kind: "none" },
    stores,
    backend:
      pythonHome === null
        ? { kind: "none" }
        : { kind: "python", python: "3.12" },
    assistant: { kind: "none" },
  });
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  const { manifest } = parsed;
  const folder = versionFolder(dataDir, manifest);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "manifest.json"), JSON.stringify(manifest));
  if (pythonHome !== null) venvOn(folder, pythonHome);
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
  mkdirSync(join(dataDir, "plugin-secrets"), { recursive: true });
  writeFileSync(join(dataDir, "plugin-secrets", `${id}.bin`), "encrypted");
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
  expect(there("plugin-secrets", "seating-plan.bin")).toBe(true);
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
  expect(there("plugin-secrets", "seating-plan.bin")).toBe(false);
  expect(there("plugin-secrets", "class-timer.bin")).toBe(true);
  expect(there("stores", "rooms")).toBe(false);
  expect(there("stores", "timetable", "kept.txt")).toBe(true);
  expect(there("plugin-data", "class-timer", "kept.txt")).toBe(true);
});

test("the version the record names is removed, even if an update swapped it in after the uninstall was asked for", async () => {
  const asked = installedOnDisk("seating-plan", []);
  const swapped = versionFolder(dataDir, {
    id: asked.manifest.id,
    version: PluginVersion.parse("1.1.0"),
  });
  mkdirSync(swapped);
  writeFileSync(
    join(dataDir, "installed-plugins.json"),
    JSON.stringify([{ id: "seating-plan", version: "1.1.0" }]),
  );

  await uninstallPlugin(deps(), asked, "keep-data");

  expect(record()).toEqual([]);
  expect(existsSync(swapped)).toBe(false);
});

test("uninstalling a UI-only Plugin runs no uv and leaves the Python Plugins' uv alone", async () => {
  const used = interpreter("cpython-3.12.7-windows-x86_64-none");
  installedOnDisk("attendance", [], used);
  const plugin = installedOnDisk("seating-plan", []);

  await uninstallPlugin(deps(), plugin, "keep-data");

  expect(uvRuns).toEqual([]);
  expect(existsSync(used)).toBe(true);
});

test("uninstalling the last Python-Backend Plugin deletes uv, its interpreters and its cache, without running it", async () => {
  installedOnDisk("class-timer", []);
  const plugin = installedOnDisk(
    "attendance",
    [],
    join(interpreter("cpython-3.12.7-windows-x86_64-none"), "bin"),
  );
  mkdirSync(join(dataDir, "uv", "cache"));

  await uninstallPlugin(deps(), plugin, "keep-data");

  expect(uvRuns).toEqual([]);
  expect(there("uv")).toBe(false);
  expect(there("class-timer@1.0.0")).toBe(true);
});

test("uninstalling a Python-Backend Plugin uninstalls each interpreter no remaining venv refers to, then prunes uv's cache", async () => {
  const kept = interpreter("cpython-3.12.7-macos-aarch64-none");
  const keptForUpdate = interpreter("cpython-3.13.1-macos-aarch64-none");
  const unused = interpreter("cpython-3.11.9-macos-aarch64-none");
  interpreter("cpython-3.10.4-macos-aarch64-none");
  // uv's minor-version link, which a venv's home may go through, and its lock file.
  const minorLink = join(
    dataDir,
    "uv",
    "python",
    "cpython-3.12-macos-aarch64-none",
  );
  symlinkSync(kept, minorLink, "junction");
  writeFileSync(join(dataDir, "uv", "python", ".lock"), "");
  installedOnDisk("class-timer", [], join(minorLink, "bin"));
  // An update built and waiting for class-timer to close: its venv counts too.
  venvOn(
    versionFolder(dataDir, {
      id: PluginId.parse("class-timer"),
      version: PluginVersion.parse("1.1.0"),
    }),
    join(keptForUpdate, "bin"),
  );
  const plugin = installedOnDisk("attendance", [], join(unused, "bin"));

  await uninstallPlugin(deps(), plugin, "keep-data");

  expect(uvRuns).toEqual([
    {
      args: [
        "python",
        "uninstall",
        "cpython-3.10.4-macos-aarch64-none",
        "cpython-3.11.9-macos-aarch64-none",
      ],
      cwd: dataDir,
    },
    { args: ["cache", "prune"], cwd: dataDir },
  ]);
});
