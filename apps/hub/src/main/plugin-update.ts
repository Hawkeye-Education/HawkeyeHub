// Silent updates (ADR 0005, spec #91). On each Registry check, an installed Plugin offered at a newer
// installable version is built through the install steps up to `<id>@<version>` (`buildVersion`),
// then swapped in: write the record, then delete the old version's folder. A Plugin that is open,
// or closing, keeps its version until the Lifecycle has closed it; the swap happens then. Builds
// and swaps are jobs of the one job queue.

import semver from "semver";
import { rmSync } from "node:fs";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import type { PluginRef } from "./diagnostics";
import {
  readRecord,
  versionFolder,
  writeRecord,
  type InstalledPlugin,
} from "./installed-plugins";
import type { JobQueue } from "./job-queue";
import type { Lifecycle } from "./lifecycle";
import {
  buildVersion,
  type InstallDeps,
  type InstallFailureCause,
} from "./plugin-install";
import type { RegistryCheck } from "./registry";

export interface UpdateFailure {
  /** The version that failed to build; the installed one is kept. */
  plugin: PluginRef;
  cause: InstallFailureCause;
}

export interface UpdaterDeps extends InstallDeps {
  jobs: JobQueue;
  lifecycle: Pick<Lifecycle, "snapshot" | "installed" | "updated" | "onChange">;
  /** Logs `plugin-update-failed`. */
  updateFailed: (failure: UpdateFailure) => void;
}

export interface Updater {
  /**
   * Queues a build of every installed Plugin the check offers at a newer installable version.
   * Settles once those builds, and the swaps of those that are closed, have.
   */
  registryChecked(check: RegistryCheck): Promise<void>;
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { dataDir, jobs, lifecycle, updateFailed } = deps;
  // The newest version each Plugin is being built at, queued or building. A newer one supersedes it.
  const building = new Map<PluginId, string>();
  // Built versions waiting for their Plugin to close.
  const built = new Map<PluginId, InstalledPlugin>();
  // Plugins with a swap job queued, so each change does not queue another.
  const swapQueued = new Set<PluginId>();

  const discard = (plugin: InstalledPlugin): void => {
    rmSync(plugin.folder, { recursive: true, force: true });
  };

  const isRunning = (id: PluginId): boolean => {
    const { open, closing } = lifecycle.snapshot();
    return open.includes(id) || closing.includes(id);
  };

  // Swaps `id`'s built version in, if it is closed. Runs inside a job.
  const swapIfClosed = (id: PluginId): void => {
    const plugin = built.get(id);
    if (plugin === undefined || isRunning(id)) return;
    built.delete(id);
    const entries = readRecord(dataDir);
    const old = entries.find((entry) => entry.id === id);
    // Uninstalled since the build: the build is a leftover.
    if (old === undefined) {
      discard(plugin);
      return;
    }
    writeRecord(
      dataDir,
      entries.map((entry) =>
        entry.id === id ? { id, version: plugin.manifest.version } : entry,
      ),
    );
    lifecycle.updated(plugin);
    rmSync(versionFolder(dataDir, old), { recursive: true, force: true });
  };

  lifecycle.onChange(() => {
    for (const id of built.keys()) {
      if (swapQueued.has(id) || isRunning(id)) continue;
      swapQueued.add(id);
      // A throw is an unhandled rejection: a Hub crash, as with installs.
      void jobs.run(() => {
        swapQueued.delete(id);
        swapIfClosed(id);
        return Promise.resolve();
      });
    }
  });

  const update = async (
    offered: Extract<RegistryCheck, { kind: "listed" }>["plugins"][number],
  ): Promise<void> => {
    const { id, version } = offered.manifest;
    // Superseded while queued: the newer version's job builds instead.
    if (building.get(id) !== version) return;
    const outcome = await buildVersion(deps, offered);
    if (building.get(id) === version) building.delete(id);
    if (outcome.kind === "failed") {
      updateFailed({ plugin: { id, version }, cause: outcome.cause });
      return;
    }
    const superseded = built.get(id);
    if (superseded !== undefined) discard(superseded);
    built.set(id, outcome.plugin);
    swapIfClosed(id);
  };

  return {
    registryChecked: async (check) => {
      if (check.kind === "failed") return;
      const installedIds = new Set(
        lifecycle.snapshot().plugins.map(({ id }) => id),
      );
      const queued = check.plugins.flatMap((offered) => {
        const { id, version } = offered.manifest;
        if (offered.access.kind !== "installable" || !installedIds.has(id)) {
          return [];
        }
        // Newer than what is installed, built, and being built.
        const current = [
          lifecycle.installed(id).manifest.version,
          built.get(id)?.manifest.version,
          building.get(id),
        ].filter((known) => known !== undefined);
        if (current.some((known) => !semver.gt(version, known))) return [];
        building.set(id, version);
        return [jobs.run(() => update(offered))];
      });
      await Promise.all(queued);
    },
  };
}
