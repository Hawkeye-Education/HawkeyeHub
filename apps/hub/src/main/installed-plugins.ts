// The record of installed Plugins: `installed-plugins.json` in the Hub's data folder, a JSON array of
// `{id, version}` naming each Plugin's active version, beside one `<id>@<version>` folder per
// installed version. Install and update write it later; this spec only reads it. Dev mode's
// Plugins load from their own folders through the same Manifest checks, without the record.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** The Plugin as Diagnostics names it. */
export function pluginRefOf({ manifest }: InstalledPlugin): PluginRef {
  return { id: manifest.id, version: manifest.version };
}

export interface LeftOutPlugin {
  plugin: PluginRef;
  reason: PluginLeftOutReason;
}

/**
 * Reads the record and each entry's Manifest. An absent record means a fresh Hub and is written as
 * `[]`. A record that does not parse, or names an id twice, throws: the Hub must never forget what
 * is installed. An entry that cannot be loaded is left out, with why.
 */
export function loadInstalledPlugins(dataDir: AbsolutePath): {
  loaded: InstalledPlugin[];
  leftOut: LeftOutPlugin[];
} {
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

  const loaded: InstalledPlugin[] = [];
  const leftOut: LeftOutPlugin[] = [];
  for (const plugin of entries) {
    const result = loadEntry(dataDir, plugin);
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

function loadEntry(
  dataDir: AbsolutePath,
  { id, version }: PluginRef,
): LoadResult {
  return loadFolder(
    parseAbsolutePath(join(dataDir, `${id}@${version}`)),
    (manifest) => manifest.id === id && manifest.version === version,
  );
}

type LoadResult =
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
