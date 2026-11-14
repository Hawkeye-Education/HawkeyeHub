// `hub.files` for one Plugin UI (ADR 0009, ADR 0010): the folder dialog, modal to the Hub window,
// revealing a folder with the OS shell, and writing a new file into a folder. Present for every
// Plugin, with no declaration.

import type { FolderPath, PickFolderResult } from "@hawkeye-hub/hub-api";
import { randomUUID } from "node:crypto";
import { open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dialog, shell, type BaseWindow, type WebContents } from "electron";
import { z } from "zod";
import {
  FILES_OPEN_FOLDER,
  FILES_PICK_FOLDER,
  FILES_WRITE_BYTES,
  type OpenFolderAnswer,
  type StoreAnswer,
} from "../shared/plugin-preload";
import { errorCode } from "./error-code";
import { parseAbsolutePath } from "./ids";

// A bad argument is the Plugin's mistake, and rejects back to its own call.
const Title = z.string().min(1);
const Folder = z.string().transform(parseAbsolutePath);
/** One plain file name: never a path, so the write stays in `folder`. */
const FileName = z
  .string()
  .min(1)
  .refine(
    (name) =>
      name !== "." &&
      name !== ".." &&
      !name.includes("/") &&
      !name.includes("\\"),
    {
      message: "Not one plain file name",
    },
  );
const WriteBytesCall = z
  .object({ folder: Folder, name: FileName, bytes: z.instanceof(Uint8Array) })
  .strict();

/**
 * Writes `bytes` as the new file `folder/name`, atomically and never over an existing file. It first
 * claims the name with an exclusive create, so two writers racing for one name (two staff saving into
 * a shared folder) cannot both win; then it writes a temp file beside it and renames that over its own
 * claim, so the name never holds a partial file. A failed write removes the claim and the temp.
 */
export async function writeNewFile(
  folder: string,
  name: string,
  bytes: Uint8Array,
): Promise<StoreAnswer<undefined>> {
  const target = join(folder, name);
  const refused = (error: unknown): StoreAnswer<undefined> => ({
    kind: "refused",
    refusal:
      errorCode(error) === "EEXIST"
        ? { code: "exists", folder, name }
        : {
            code: "write-failed",
            folder,
            name,
            message: error instanceof Error ? error.message : String(error),
          },
  });
  try {
    await (await open(target, "wx")).close();
  } catch (error) {
    return refused(error);
  }
  const temp = join(folder, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    // Replaces the empty claim: Node's rename overwrites on Windows too (libuv passes
    // MOVEFILE_REPLACE_EXISTING); files.test.ts checks it on every CI OS.
    await rename(temp, target);
    return { kind: "done", value: undefined };
  } catch (error) {
    // Best effort: the write already failed, and that failure is what the Plugin needs to hear.
    // A claim left behind only blocks its name.
    await Promise.allSettled([
      rm(temp, { force: true }),
      rm(target, { force: true }),
    ]);
    return refused(error);
  }
}

export function serveFiles(webContents: WebContents, window: BaseWindow): void {
  webContents.ipc.handle(
    FILES_PICK_FOLDER,
    async (_event, raw: unknown): Promise<PickFolderResult> => {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: Title.parse(raw),
        properties: ["openDirectory"],
      });
      const [path] = filePaths;
      return canceled || path === undefined
        ? { kind: "cancelled" }
        : // The dialog is FolderPath's one maker; parsing checks it is absolute, and a brand is
          // granted only by a cast.
          {
            kind: "chosen",
            path: parseAbsolutePath(path) as string as FolderPath,
          };
    },
  );
  // `shell.openPath` resolves to the OS's error message, or "" once opened.
  webContents.ipc.handle(
    FILES_OPEN_FOLDER,
    async (_event, raw: unknown): Promise<OpenFolderAnswer> => {
      const message = await shell.openPath(Folder.parse(raw));
      return message === "" ? { kind: "opened" } : { kind: "failed", message };
    },
  );
  webContents.ipc.handle(FILES_WRITE_BYTES, (_event, raw: unknown) => {
    const { folder, name, bytes } = WriteBytesCall.parse(raw);
    return writeNewFile(folder, name, bytes);
  });
}
