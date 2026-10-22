// Installing a Plugin from the Registry (ADR 0005, spec #91). Every install and update goes through
// the same steps in the Hub's data folder, beside the record:
//   1. download the Plugin Package and check its sha256;
//   2. unpack it with fflate into `<id>@<version>.partial`;
//   3. (a Python Backend's venv is built here, in a later ticket);
//   4. rename the folder to `<id>@<version>`;
//   5. write the record atomically.
// `buildVersion` is steps 1 to 4, which update shares; `installPlugin` adds the record entry and the
// Plugin's data and store folders. Each runs as one job of the job queue.

import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import type { InstallFailureCause } from "../shared/hub-chrome-ipc";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import {
  loadVersion,
  pluginRefOf,
  readRecord,
  versionFolder,
  writeRecord,
  type InstalledPlugin,
} from "./installed-plugins";
import type { RegistryFetch, RegistryPlugin } from "./registry";
import { pluginDataFolder, storeFolder } from "./stores";

/** How long a Plugin Package download may take before it counts as failed. */
const PACKAGE_TIMEOUT_MS = 5 * 60_000;

export type { InstallFailureCause };

export interface InstallDeps {
  dataDir: AbsolutePath;
  /** `fetch`, or Electron's `net.fetch`: injected so tests need no network. */
  fetch: RegistryFetch;
}

export type BuildOutcome =
  | { kind: "built"; plugin: InstalledPlugin }
  | { kind: "failed"; cause: InstallFailureCause };

export type InstallOutcome =
  | { kind: "installed"; plugin: InstalledPlugin }
  | { kind: "failed"; cause: InstallFailureCause };

/**
 * Steps 1 to 4: `plugin`'s version, downloaded, checked and unpacked into `<id>@<version>`. A
 * failure leaves nothing on disk. The record is not touched.
 */
export async function buildVersion(
  { dataDir, fetch }: InstallDeps,
  plugin: RegistryPlugin,
): Promise<BuildOutcome> {
  const downloaded = await download(fetch, plugin);
  if (downloaded.kind === "failed") return downloaded;
  const ref = { id: plugin.manifest.id, version: plugin.manifest.version };
  const folder = versionFolder(dataDir, ref);
  const partial = `${folder}.partial`;
  // A leftover of the same name would mix into this one; the sweep normally got it already.
  rmSync(partial, { recursive: true, force: true });
  if (!unpack(downloaded.bytes, partial)) {
    rmSync(partial, { recursive: true, force: true });
    return { kind: "failed", cause: "unpack" };
  }
  // The package must hold the Plugin and version the Registry said it does.
  const loaded = loadVersion(parseAbsolutePath(partial), ref);
  if (loaded.kind === "left-out") {
    rmSync(partial, { recursive: true, force: true });
    return { kind: "failed", cause: "unpack" };
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

async function download(
  fetch: RegistryFetch,
  { url, sha256 }: RegistryPlugin,
): Promise<
  | { kind: "downloaded"; bytes: Uint8Array }
  | { kind: "failed"; cause: "download" | "checksum" }
> {
  let bytes: Uint8Array;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PACKAGE_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: "failed", cause: "download" };
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    // Not swallowed: any failure to get the whole package is the `download` outcome, which the
    // caller logs. fetch rejects with a TypeError, or an abort's DOMException, for every such case.
    return { kind: "failed", cause: "download" };
  }
  // ponytail: held in memory, not a temp file; Plugin Packages are small, and fflate unzips from
  // memory anyway. Stream to disk if packages grow to hundreds of MB.
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    return { kind: "failed", cause: "checksum" };
  }
  return { kind: "downloaded", bytes };
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
  // Zip paths use "/"; a folder entry ends with one. Every other segment is a plain name.
  const safe = entries.every(([path]) =>
    path
      .replace(/\/$/, "")
      .split("/")
      .every(
        (segment) =>
          segment !== "" &&
          segment !== "." &&
          segment !== ".." &&
          !/[\\:\0]/.test(segment),
      ),
  );
  if (!safe) return false;
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
