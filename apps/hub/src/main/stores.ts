// Shared Stores as a Plugin UI reaches them through `hub.stores` (ADR 0008, PLUGIN_STANDARD.md §6):
// plain files in `stores/<name>` under the Hub's data folder, the same folders a Backend gets.

import { randomUUID } from "node:crypto";
import { mkdirSync, watch } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import type { HubError, StoreChange } from "@hawkeye-hub/hub-api";
import type { PluginId, StoreName } from "@hawkeye-hub/plugin-format";
import type { WebContents } from "electron";
import { StoreCall } from "../shared/store-call";
import {
  STORES,
  STORES_CHANGED,
  type StoreAnswer,
  type StoreChanged,
} from "../shared/plugin-preload";
import { errorCode } from "./error-code";
import type { AbsolutePath } from "./ids";

/** The `HubError`s a store call rejects with, each the Plugin's own mistake. */
export type StoreRefusal = Exclude<HubError, { code: "backend-error" }>;

/** Thrown by a store call the Plugin got wrong; the Plugin preload rejects with its `refusal`. */
export class StoreRefused extends Error {
  constructor(readonly refusal: StoreRefusal) {
    super(`Store call refused: ${JSON.stringify(refusal)}`);
  }
}

/** Ends the name of the temp file a write goes through, which lists and watches never show. */
const TEMP_SUFFIX = ".hub-tmp";

/**
 * Whether `path` is relative and POSIX-style with each segment a plain name: so no `..`, `.` or
 * empty segment (which also rules out a leading `/`), and no `\` or `:` (a Windows drive or
 * stream). Joined under a folder, it stays inside it.
 */
export function isPlainPath(path: string): boolean {
  return path
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !/[\\:\0]/.test(segment),
    );
}

/** A plain path's segments (`isPlainPath`), naming no file that could be a write's temp file. */
function segmentsOf(path: string): string[] {
  if (!isPlainPath(path) || isTemp(path)) {
    throw new StoreRefused({ code: "bad-path", path });
  }
  return path.split("/");
}

/**
 * Writes `file` atomically (ADR 0008): a temp file in the same folder, renamed over it, so a reader
 * sees the old contents or the new, never part of either. Makes its folders first.
 */
async function replace(
  file: string,
  contents: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = join(
    dirname(file),
    `.${basename(file)}.${randomUUID()}${TEMP_SUFFIX}`,
  );
  try {
    await writeFile(temp, contents);
    await rename(temp, file);
  } catch (error) {
    // Nothing half-written stays behind; the write's own failure is what the caller sees.
    await rm(temp, { force: true });
    throw error;
  }
}

/** A Shared Store's folder: the one a Backend gets in `initialize`, and `hub.stores` reads. */
export function storeFolder(
  hubDataDir: AbsolutePath,
  store: StoreName,
): string {
  return join(hubDataDir, "stores", store);
}

/** A Plugin's Plugin Data folder: keyed by id, never version, so it survives updates (ADR 0008). */
export function pluginDataFolder(
  hubDataDir: AbsolutePath,
  id: PluginId,
): string {
  return join(hubDataDir, "plugin-data", id);
}

export function createStores(
  hubDataDir: AbsolutePath,
  declared: readonly StoreName[],
) {
  // The Plugin's store name, once it is one the Manifest declares.
  const declaredStore = (store: string): StoreName => {
    const found = declared.find((name) => name === store);
    if (found === undefined) {
      throw new StoreRefused({ code: "store-not-declared", store });
    }
    return found;
  };
  const fileOf = (store: string, path: string): string =>
    join(storeFolder(hubDataDir, declaredStore(store)), ...segmentsOf(path));
  const read = async (store: string, path: string): Promise<Buffer> => {
    try {
      return await readFile(fileOf(store, path));
    } catch (error) {
      // No file there: nothing at all, a folder, or a path through a file.
      const code = errorCode(error);
      if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") {
        throw new StoreRefused({ code: "not-found", store, path });
      }
      throw error;
    }
  };

  // Each declared store's folder exists from the open on, though it may be empty (ADR 0008).
  for (const store of declared) {
    mkdirSync(storeFolder(hubDataDir, store), { recursive: true });
  }

  return {
    async list(store: string): Promise<string[]> {
      const folder = storeFolder(hubDataDir, declaredStore(store));
      const entries = await readdir(folder, {
        recursive: true,
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isFile() && !isTemp(entry.name))
        .map((entry) =>
          posixPathOf(folder, join(entry.parentPath, entry.name)),
        );
    },
    readText: async (store: string, path: string) =>
      (await read(store, path)).toString("utf8"),
    readBytes: async (store: string, path: string) =>
      new Uint8Array(await read(store, path)),
    writeText: async (store: string, path: string, text: string) =>
      replace(fileOf(store, path), text),
    writeBytes: async (store: string, path: string, bytes: Uint8Array) =>
      replace(fileOf(store, path), bytes),
    /**
     * Reports each file anyone changes in the store: written or replaced while it is there,
     * removed once it is gone. Folders and writes' temp files are left out. Returns the stop.
     */
    watch(store: string, handler: (change: StoreChange) => void): () => void {
      const folder = storeFolder(hubDataDir, declaredStore(store));
      let watching = true;
      const watcher = watch(folder, { recursive: true }, (_event, name) => {
        // No name: on Windows, more changes came at once than its buffer holds, and the OS named
        // none of them (libuv src/win/fs-event.c; stores.test.ts makes one). Thrown, it would crash
        // the Hub. ponytail: those changes go unreported; re-list the store and report each file
        // as changed if a Plugin ever needs every one.
        if (name === null) return;
        if (isTemp(name)) return;
        const file = join(folder, name);
        const path = posixPathOf(folder, file);
        // Whether it is there now says which change it was; an event can name either.
        void stat(file).then(
          (found) => {
            if (watching && found.isFile()) handler({ path, kind: "changed" });
          },
          (error: unknown) => {
            if (errorCode(error) !== "ENOENT") throw error;
            if (watching) handler({ path, kind: "removed" });
          },
        );
      });
      return () => {
        watching = false;
        watcher.close();
      };
    },
  };
}

/**
 * Serves `hub.stores` to one Plugin UI's page over the Plugin preload's channels, for the stores
 * its Manifest declares, until the page is destroyed.
 */
export function serveStores(
  webContents: WebContents,
  hubDataDir: AbsolutePath,
  declared: readonly StoreName[],
): void {
  const stores = createStores(hubDataDir, declared);
  // Each watch's stop, by the id the preload gave it.
  const watches = new Map<number, () => void>();
  const answer = async (call: StoreCall): Promise<unknown> => {
    switch (call.call) {
      case "list":
        return stores.list(call.store);
      case "readText":
        return stores.readText(call.store, call.path);
      case "readBytes":
        return stores.readBytes(call.store, call.path);
      case "writeText":
        return stores.writeText(call.store, call.path, call.text);
      case "writeBytes":
        return stores.writeBytes(call.store, call.path, call.bytes);
      case "watch": {
        const { id } = call;
        const stop = stores.watch(call.store, (change) => {
          const changed: StoreChanged = { id, change };
          webContents.send(STORES_CHANGED, changed);
        });
        watches.set(id, stop);
        return null;
      }
      case "unwatch":
        watches.get(call.id)?.();
        watches.delete(call.id);
        return null;
      default: {
        const unreachable: never = call;
        throw new Error(`Unknown store call ${JSON.stringify(unreachable)}`);
      }
    }
  };
  webContents.ipc.handle(
    STORES,
    async (_event, raw: unknown): Promise<StoreAnswer<unknown>> => {
      try {
        return { kind: "done", value: await answer(StoreCall.parse(raw)) };
      } catch (error) {
        // A refusal is the Plugin's to handle; anything else rejects as the Hub failure it is.
        if (error instanceof StoreRefused) {
          return { kind: "refused", refusal: error.refusal };
        }
        throw error;
      }
    },
  );

  // Every watch stops with the page, before it could send to a destroyed one.
  webContents.once("destroyed", () => {
    for (const stop of watches.values()) stop();
    watches.clear();
  });
}

function isTemp(name: string): boolean {
  return name.endsWith(TEMP_SUFFIX);
}

/** `file` relative to the store's `folder`, POSIX-style, as a Plugin UI names it. */
function posixPathOf(folder: string, file: string): string {
  return relative(folder, file).split(sep).join("/");
}
