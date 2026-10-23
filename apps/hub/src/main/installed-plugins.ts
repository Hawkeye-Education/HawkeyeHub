// The record of installed Plugins: `installed-plugins.json` in the Hub's data folder, a JSON array of
// `{id, version}` naming each Plugin's active version, beside one `<id>@<version>` folder per
// installed version. The record is the only source of truth: the job queue writes it whole and
// atomically, and the launch sweep deletes every Plugin folder it does not name. Dev mode's Plugins
// load from their own folders through the same Manifest checks, without the record.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  parseManifest,
  PluginId,
  PluginVersion,
  type Manifest,
} from "@hawkeye-hub/plugin-format";
import { z } from "zod";
import type { PluginLeftOutReason, PluginRef } from "./diagnostics";
import { parseAbsolutePath, type AbsolutePath } from "./ids";

export const RECORD_FILE = "installed-plugins.json";

const InstalledRecord = z.array(
  z.strictObject({ id: PluginId, version: PluginVersion }),
);

export interface InstalledPlugin {
  /** The `<id>@<version>` folder holding the unpacked Plugin Package, or in dev mode `plugins/<id>`. */
  folder: AbsolutePath;
  manifest: Manifest;
}

/** The Plugin, installed or offered by the Registry, as Diagnostics names it. */
export function pluginRefOf({
  manifest,
}: Pick<InstalledPlugin, "manifest">): PluginRef {
  return { id: manifest.id, version: manifest.version };
}

/** The folder one installed version is unpacked into, beside the record. */
export function versionFolder(
  dataDir: AbsolutePath,
  { id, version }: PluginRef,
): AbsolutePath {
  return parseAbsolutePath(join(dataDir, `${id}@${version}`));
}

/**
 * Where a job building `ref` downloads its Plugin Package and unpacks it, before the rename to
 * `versionFolder`. The launch sweep deletes both.
 */
export function buildPaths(
  dataDir: AbsolutePath,
  ref: PluginRef,
): { download: AbsolutePath; partial: AbsolutePath } {
  const folder = versionFolder(dataDir, ref);
  return {
    download: parseAbsolutePath(`${folder}.download`),
    partial: parseAbsolutePath(`${folder}.partial`),
  };
}

const VERSION_ENTRY =
  /^(?<id>[^@]+)@(?<version>.+?)(?<build>\.partial|\.download)?$/;

/** The data-folder entry `name`, if `versionFolder` or `buildPaths` named it; `partial` for a build's. */
export function versionEntryOf(
  name: string,
): { plugin: PluginRef; partial: boolean } | null {
  const groups = VERSION_ENTRY.exec(name)?.groups;
  if (groups === undefined) return null;
  const id = PluginId.safeParse(groups["id"]);
  const version = PluginVersion.safeParse(groups["version"]);
  if (!id.success || !version.success) return null;
  return {
    plugin: { id: id.data, version: version.data },
    partial: groups["build"] !== undefined,
  };
}

/**
 * The record's entries. An absent record means a fresh Hub and is written as `[]`. A record that
 * does not parse, or names an id twice, throws: the Hub must never forget what is installed.
 */
export function readRecord(dataDir: AbsolutePath): PluginRef[] {
  const recordPath = join(dataDir, RECORD_FILE);
  if (!existsSync(recordPath)) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(recordPath, "[]\n");
  }
  const entries = InstalledRecord.parse(
    JSON.parse(readFileSync(recordPath, "utf8")),
  );
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new Error(`${RECORD_FILE} names a Plugin id twice`);
  }
  return entries;
}

/**
 * Replaces the record atomically: a temp file renamed over it, so a crash leaves the old record or
 * the new, never part of either. Only the job queue writes it, one job at a time, so one temp name
 * serves.
 */
export function writeRecord(
  dataDir: AbsolutePath,
  entries: readonly PluginRef[],
): void {
  const recordPath = join(dataDir, RECORD_FILE);
  const temp = `${recordPath}.tmp`;
  writeFileSync(
    temp,
    JSON.stringify(entries.map(({ id, version }) => ({ id, version }))) + "\n",
  );
  renameSync(temp, recordPath);
}

/** What the launch sweep deleted: a build's leftover (`partial`), or a version the record does not name. */
export interface SweptFolder {
  plugin: PluginRef;
  partial: boolean;
}

/**
 * At launch, before loading (spec #91): deletes every build's leftover (`buildPaths`), left by a
 * job cut short, and every `<id>@<version>` folder the record does not name. Nothing else in the
 * data folder is touched.
 */
export function sweepLeftovers(dataDir: AbsolutePath): SweptFolder[] {
  const recorded = new Set<string>(
    readRecord(dataDir).map((ref) => versionFolder(dataDir, ref)),
  );
  return readdirSync(dataDir).flatMap((name) => {
    const swept = versionEntryOf(name);
    const path = join(dataDir, name);
    if (swept === null || (!swept.partial && recorded.has(path))) return [];
    rmSync(path, { recursive: true, force: true });
    return [swept];
  });
}

export interface LeftOutPlugin {
  plugin: PluginRef;
  reason: PluginLeftOutReason;
}

/**
 * Reads the record (`readRecord`) and each entry's Manifest. An entry that cannot be loaded is
 * left out, with why.
 */
export function loadInstalledPlugins(dataDir: AbsolutePath): {
  loaded: InstalledPlugin[];
  leftOut: LeftOutPlugin[];
} {
  const loaded: InstalledPlugin[] = [];
  const leftOut: LeftOutPlugin[] = [];
  for (const plugin of readRecord(dataDir)) {
    const result = loadVersion(versionFolder(dataDir, plugin), plugin);
    if (result.kind === "loaded") loaded.push(result.plugin);
    else leftOut.push({ plugin, reason: result.reason });
  }
  return { loaded, leftOut };
}

/**
 * Dev mode's Plugins (PLUGIN_STANDARD §9.4): each id's `<pluginsDir>/<id>` folder, whatever version
 * its Manifest says. Never reads or writes the record. A folder that cannot be loaded throws with
 * why: a developer must see it, not find the Plugin quietly missing.
 */
export function loadDevPlugins(
  pluginsDir: AbsolutePath,
  ids: PluginId[],
): InstalledPlugin[] {
  return ids.map((id) => {
    const folder = parseAbsolutePath(join(pluginsDir, id));
    const result = loadFolder(folder, (manifest) => manifest.id === id);
    if (result.kind === "left-out") {
      throw new Error(`Plugin "${id}" (${folder}): ${result.reason}`);
    }
    return result.plugin;
  });
}

/** Reads `folder`, which must hold Plugin `id` at `version`. */
export function loadVersion(
  folder: AbsolutePath,
  { id, version }: PluginRef,
): LoadResult {
  return loadFolder(
    folder,
    (manifest) => manifest.id === id && manifest.version === version,
  );
}

export type LoadResult =
  | { kind: "loaded"; plugin: InstalledPlugin }
  | { kind: "left-out"; reason: PluginLeftOutReason };

/** Reads `folder`'s Manifest, which must be the Plugin `agrees` expects. */
function loadFolder(
  folder: AbsolutePath,
  agrees: (manifest: Manifest) => boolean,
): LoadResult {
  if (!existsSync(folder))
    return { kind: "left-out", reason: "folder-missing" };
  const manifestPath = join(folder, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { kind: "left-out", reason: "manifest-invalid" };
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    // Not swallowed: unparseable JSON is one way a Manifest is invalid, and the caller logs it.
    if (error instanceof SyntaxError) {
      return { kind: "left-out", reason: "manifest-invalid" };
    }
    throw error;
  }
  const parsed = parseManifest(json);
  if (parsed.kind === "invalid") {
    return { kind: "left-out", reason: "manifest-invalid" };
  }
  const { manifest } = parsed;
  if (!agrees(manifest)) {
    return { kind: "left-out", reason: "manifest-disagrees" };
  }
  return { kind: "loaded", plugin: { folder, manifest } };
}
