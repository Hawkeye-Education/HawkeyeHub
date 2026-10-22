// Real uv, from Astral's GitHub, PBS and all: slow and online, so it runs only where
// HAWKEYE_HUB_REAL_UV=1, which CI sets on its Windows and macOS runners.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@hawkeye-hub/plugin-format";
import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { parseAbsolutePath } from "./ids";
import { venvPython } from "./platform";
import { installPlugin } from "./plugin-install";
import { uninstallPlugin } from "./plugin-uninstall";
import type { RegistryFetch, RegistryPlugin } from "./registry";
import { createUv, UV_VERSION } from "./uv";

const PYPROJECT = `[project]
name = "backend"
version = "1.0.0"
requires-python = ">=3.12"
dependencies = []
`;

// What `uv lock` writes for PYPROJECT.
const UV_LOCK = `version = 1
revision = 5
requires-python = ">=3.12"

[[package]]
name = "backend"
version = "1.0.0"
source = { virtual = "." }
`;

/** A Python-Backend Plugin `id` on `python`, whose Backend prints where its Python lives. */
function offered(id: string, uvLock: string, python = "3.12") {
  const json = {
    id,
    version: "1.0.0",
    hubApi: "^1.0.0",
    name: id,
    description: "A fixture.",
    platforms: ["win32-x64", "darwin-arm64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "python", python },
    assistant: { kind: "none" },
  };
  const bytes = zipSync({
    "manifest.json": strToU8(JSON.stringify(json)),
    "icon.svg": strToU8("<svg/>"),
    ui: { "index.html": strToU8("<p>Hi</p>") },
    backend: {
      "main.py": strToU8("import sys\nprint(sys.base_prefix)\n"),
      "pyproject.toml": strToU8(PYPROJECT),
      "uv.lock": strToU8(uvLock),
    },
  });
  const parsed = parseManifest(json);
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  const plugin: RegistryPlugin = {
    manifest: parsed.manifest,
    url: `https://registry.example/${id}.zip` as RegistryPlugin["url"],
    sha256: createHash("sha256")
      .update(bytes)
      .digest("hex") as RegistryPlugin["sha256"],
    iconUrl: `https://registry.example/${id}.svg` as RegistryPlugin["iconUrl"],
    access: { kind: "installable" },
  };
  return { plugin, bytes };
}

describe.runIf(process.env["HAWKEYE_HUB_REAL_UV"] === "1")("real uv", () => {
  test(
    "a Hub with no uv downloads it, builds a venv on uv's own Python, refuses a broken lock, prunes an unused interpreter, and drops it all with the last Python Plugin",
    async () => {
      const dataDir = parseAbsolutePath(
        mkdtempSync(join(tmpdir(), "hub-real-uv-")),
      );
      const seating = offered("seating-plan", UV_LOCK);
      const broken = offered("attendance", "this is not a lock file");
      const timer = offered("class-timer", UV_LOCK, "3.13");
      const packages = new Map(
        [seating, broken, timer].map(({ plugin, bytes }) => [
          plugin.url,
          bytes,
        ]),
      );
      // Plugin Packages from memory; uv itself from GitHub.
      const fetchAny: RegistryFetch = (url, init) => {
        const bytes = packages.get(url as RegistryPlugin["url"]);
        return bytes === undefined
          ? fetch(url, init)
          : Promise.resolve(new Response(bytes));
      };
      const uv = createUv({
        dataDir,
        fetch: fetchAny,
        platform: `${process.platform}-${process.arch}`,
      });
      const deps = { dataDir, fetch: fetchAny, uv };

      const installed = await installPlugin(deps, seating.plugin);

      if (installed.kind === "failed") {
        throw new Error(JSON.stringify(installed));
      }
      expect(existsSync(join(dataDir, "uv", `uv-${UV_VERSION}`))).toBe(true);
      const backend = join(installed.plugin.folder, "backend");
      const basePrefix = execFileSync(venvPython(backend), ["main.py"], {
        cwd: backend,
        encoding: "utf8",
      }).trim();
      // uv's own build of Python, in the Hub's data folder: never staff's.
      expect(realpathSync(basePrefix)).toContain(
        realpathSync(join(dataDir, "uv", "python")),
      );

      const failed = await installPlugin(deps, broken.plugin);

      expect(failed).toMatchObject({ kind: "failed", cause: "environment" });
      expect(
        readdirSync(dataDir).filter((name) => name.startsWith("attendance")),
      ).toEqual([]);

      const other = await installPlugin(deps, timer.plugin);
      if (other.kind === "failed") throw new Error(JSON.stringify(other));
      const interpreters = () =>
        readdirSync(join(dataDir, "uv", "python")).filter((name) =>
          name.startsWith("cpython-3.13."),
        );
      expect(interpreters()).toHaveLength(1);
      const uninstallDeps = {
        dataDir,
        uv,
        clearPartition: () => Promise.resolve(),
      };

      await uninstallPlugin(uninstallDeps, other.plugin, "keep-data");

      expect(interpreters()).toEqual([]);

      await uninstallPlugin(uninstallDeps, installed.plugin, "keep-data");

      expect(existsSync(join(dataDir, "uv"))).toBe(false);
    },
    10 * 60_000,
  );
});
