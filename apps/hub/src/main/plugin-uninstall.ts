// Uninstalling a Plugin (ADR 0005, spec #91), as one job of the job queue, once the Plugin is
// closed: the record entry goes, then the `<id>@<version>` folder. With "Also delete my data" its
// partition's storage, its Plugin Data and every Shared Store no other installed Plugin declares go
// too. A Python Backend's interpreters and uv's cache are pruned, and uv goes with the last one
// (ADR 0011). Nothing here can fail with a cause staff could act on, so a throw is a Hub crash.

import { rmSync } from "node:fs";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import type { AbsolutePath } from "./ids";
import {
  loadInstalledPlugins,
  readRecord,
  versionFolder,
  writeRecord,
  type InstalledPlugin,
} from "./installed-plugins";
import { pluginDataFolder, storeFolder } from "./stores";
import { pruneUv, type Uv } from "./uv";

/** Staff's choice in the uninstall dialog: the "Also delete my data" checkbox. */
export type UninstallData = "keep-data" | "delete-data";

export interface UninstallDeps {
  dataDir: AbsolutePath;
  /** Clears the `persist:plugin-<id>` partition's storage: Electron's, injected so tests need none. */
  clearPartition: (id: PluginId) => Promise<void>;
  /** Runs uv to prune what a Python Backend leaves: injected so tests need no uv. */
  uv: Uv;
}

export async function uninstallPlugin(
  { dataDir, clearPartition, uv }: UninstallDeps,
  { manifest }: InstalledPlugin,
  data: UninstallData,
): Promise<void> {
  const entries = readRecord(dataDir);
  // The record's version, not `manifest`'s: a silent update may have swapped one in since staff
  // asked, while the Plugin closed.
  const entry = entries.find(({ id }) => id === manifest.id);
  if (entry === undefined) {
    throw new Error(`${manifest.id} is not in the record`);
  }
  writeRecord(
    dataDir,
    entries.filter((other) => other !== entry),
  );
  rmSync(versionFolder(dataDir, entry), { recursive: true, force: true });
  if (manifest.backend.kind === "python") await pruneUv(uv, dataDir);
  if (data === "keep-data") return;
  await clearPartition(manifest.id);
  rmSync(pluginDataFolder(dataDir, manifest.id), {
    recursive: true,
    force: true,
  });
  // A Plugin the record names but that could not be loaded declares no store we know of.
  const stillDeclared = new Set(
    loadInstalledPlugins(dataDir).loaded.flatMap(
      (plugin) => plugin.manifest.stores,
    ),
  );
  for (const store of manifest.stores) {
    if (!stillDeclared.has(store)) {
      rmSync(storeFolder(dataDir, store), { recursive: true, force: true });
    }
  }
}
