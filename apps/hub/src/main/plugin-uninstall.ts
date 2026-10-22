// Uninstalling a Plugin (ADR 0005, spec #91), as one job of the job queue, once the Plugin is
// closed: the record entry goes, then the `<id>@<version>` folder. With "Also delete my data" its
// partition's storage, its Plugin Data and every Shared Store no other installed Plugin declares go
// too. Nothing here can fail with a cause staff could act on, so a throw is a Hub crash.

import { rmSync } from "node:fs";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import type { AbsolutePath } from "./ids";
import {
  loadInstalledPlugins,
  readRecord,
  writeRecord,
  type InstalledPlugin,
} from "./installed-plugins";
import { pluginDataFolder, storeFolder } from "./stores";

/** Staff's choice in the uninstall dialog: the "Also delete my data" checkbox. */
export type UninstallData = "keep-data" | "delete-data";

export interface UninstallDeps {
  dataDir: AbsolutePath;
  /** Clears the `persist:plugin-<id>` partition's storage: Electron's, injected so tests need none. */
  clearPartition: (id: PluginId) => Promise<void>;
}

export async function uninstallPlugin(
  { dataDir, clearPartition }: UninstallDeps,
  { folder, manifest }: InstalledPlugin,
  data: UninstallData,
): Promise<void> {
  writeRecord(
    dataDir,
    readRecord(dataDir).filter(({ id }) => id !== manifest.id),
  );
  rmSync(folder, { recursive: true, force: true });
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
