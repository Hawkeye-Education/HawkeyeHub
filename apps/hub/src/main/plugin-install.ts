// Installing a Plugin from the Registry (ADR 0005, spec #91). Every install and update goes through
// the same steps in the Hub's data folder, beside the record:
//   1. download the Plugin Package to `<id>@<version>.download` and check its sha256;
//   2. unpack it with fflate into `<id>@<version>.partial`, and delete the download;
//   3. build a Python Backend's venv in `backend/` with uv (ADR 0011);
//   4. rename the folder to `<id>@<version>`;
//   5. write the record atomically.
// `buildVersion` is steps 1 to 4, which update shares; `installPlugin` adds the record entry and the
// Plugin's data and store folders. Each runs as one job of the job queue.

import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { PythonMinor } from "@hawkeye-hub/plugin-format";
import { unzipSync } from "fflate";
import type { InstallFailureCause } from "../shared/hub-chrome-ipc";
import { downloadChecked } from "./download";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import {
  buildPaths,
  loadVersion,
  pluginRefOf,
  readRecord,
  versionFolder,
  writeRecord,
  type InstalledPlugin,
} from "./installed-plugins";
import type { RegistryFetch, RegistryPlugin } from "./registry";
import { isPlainPath, pluginDataFolder, storeFolder } from "./stores";
import { pruneUv, type Uv } from "./uv";

/** How much of uv's stderr an `environment` failure keeps: its end, where uv says what went wrong. */
const STDERR_LINES = 50;

export type { InstallFailureCause };

/** Why a build failed; `environment` carries the end of uv's stderr for hub.log. */
export type InstallFailure =
  | { cause: Exclude<InstallFailureCause, "environment"> }
  | { cause: "environment"; stderr: string };

export interface InstallDeps {
  dataDir: AbsolutePath;
  /** `fetch`, or Electron's `net.fetch`: injected so tests need no network. */
  fetch: RegistryFetch;
  /** Runs uv for a Python Backend's venv: injected so tests need no uv. */
  uv: Uv;
}

export type BuildOutcome =
  | { kind: "built"; plugin: InstalledPlugin }
  | ({ kind: "failed" } & InstallFailure);

export type InstallOutcome =
  | { kind: "installed"; plugin: InstalledPlugin }
  | ({ kind: "failed" } & InstallFailure);

/**
 * Steps 1 to 4: `plugin`'s version, downloaded, checked and unpacked into `<id>@<version>`. A
 * failure leaves nothing on disk. The record is not touched.
 */
export async function buildVersion(
  { dataDir, fetch, uv }: InstallDeps,
  plugin: RegistryPlugin,
): Promise<BuildOutcome> {
  const ref = pluginRefOf(plugin);
  const folder = versionFolder(dataDir, ref);
  const { download, partial } = buildPaths(dataDir, ref);
  const downloaded = await downloadChecked(
    fetch,
    plugin.url,
    plugin.sha256,
    download,
  );
  if (downloaded.kind === "failed") {
    return { kind: "failed", cause: downloaded.cause };
  }
  // A leftover of the same name would mix into this one; the sweep normally got it already.
  rmSync(partial, { recursive: true, force: true });
  const unpacked = unpack(readFileSync(download), partial);
  rmSync(download);
  if (!unpacked) {
    rmSync(partial, { recursive: true, force: true });
    return { kind: "failed", cause: "unpack" };
  }
  // The package must hold the Plugin and version the Registry said it does.
  const loaded = loadVersion(parseAbsolutePath(partial), ref);
  if (loaded.kind === "left-out") {
    rmSync(partial, { recursive: true, force: true });
    return { kind: "failed", cause: "unpack" };
  }
  const { backend } = loaded.plugin.manifest;
  if (backend.kind === "python") {
    const venv = await buildVenv(
      uv,
      parseAbsolutePath(join(partial, "backend")),
      backend.python,
    );
    if (venv.kind === "failed") {
      rmSync(partial, { recursive: true, force: true });
      // What uv set up for it goes too, uv itself if no other Python-Backend Plugin needs it.
      await pruneUv(uv, dataDir);
      return venv;
    }
  }
  // Not named by the record (install needs the Plugin not installed, update a newer version), so
  // anything already there is a leftover.
  rmSync(folder, { recursive: true, force: true });
  renameSync(partial, folder);
  return {
    kind: "built",
    plugin: { folder, manifest: loaded.plugin.manifest },
  };
}

/**
 * Installs `plugin`, which is not installed: builds it, adds it to the record, and makes its Plugin
 * Data folder and each declared Shared Store's folder.
 */
export async function installPlugin(
  deps: InstallDeps,
  plugin: RegistryPlugin,
): Promise<InstallOutcome> {
  const built = await buildVersion(deps, plugin);
  if (built.kind === "failed") return built;
  const { dataDir } = deps;
  writeRecord(dataDir, [...readRecord(dataDir), pluginRefOf(built.plugin)]);
  const { manifest } = built.plugin;
  mkdirSync(pluginDataFolder(dataDir, manifest.id), { recursive: true });
  for (const store of manifest.stores) {
    mkdirSync(storeFolder(dataDir, store), { recursive: true });
  }
  return { kind: "installed", plugin: built.plugin };
}

/**
 * Step 3: `backend/.venv`, where `venvPython` looks, on uv's own build of `python` (never staff's
 * Python), with the locked dependencies only. Not editable: the folder is renamed after this, and
 * an editable install would point into the `.partial` folder.
 */
async function buildVenv(
  uv: Uv,
  backendDir: AbsolutePath,
  python: PythonMinor,
): Promise<{ kind: "built" } | ({ kind: "failed" } & InstallFailure)> {
  for (const args of [
    // Not into staff's PATH folder or, on Windows, the registry: only the Hub's uv finds it.
    ["python", "install", "--no-bin", "--no-registry", python],
    ["sync", "--frozen", "--no-dev", "--no-editable", "--python", python],
  ]) {
    const run = await uv.run(args, backendDir);
    if (run.kind === "failed") {
      const stderr = run.stderr
        .trimEnd()
        .split(/\r?\n/)
        .slice(-STDERR_LINES)
        .join("\n");
      return { kind: "failed", cause: "environment", stderr };
    }
  }
  return { kind: "built" };
}

/**
 * Unpacks the zip `bytes` into `folder`. False if they are not a zip, or an entry's path would land
 * outside `folder`.
 */
function unpack(bytes: Uint8Array, folder: string): boolean {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    // Not swallowed: fflate throws for every malformed zip, which is the `unpack` outcome.
    return false;
  }
  const entries = Object.entries(files);
  // Zip paths use "/"; a folder entry ends with one.
  if (!entries.every(([path]) => isPlainPath(path.replace(/\/$/, "")))) {
    return false;
  }
  mkdirSync(folder, { recursive: true });
  for (const [path, contents] of entries) {
    const target = join(folder, ...path.split("/"));
    if (path.endsWith("/")) {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
  }
  return true;
}
