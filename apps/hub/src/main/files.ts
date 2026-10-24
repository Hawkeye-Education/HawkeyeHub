// `hub.files` for one Plugin UI (ADR 0009, ADR 0010): the folder dialog, modal to the Hub window,
// and revealing a folder with the OS shell. Present for every Plugin, with no declaration.

import type { PickFolderResult } from "@hawkeye-hub/hub-api";
import { dialog, shell, type BaseWindow, type WebContents } from "electron";
import { z } from "zod";
import {
  FILES_OPEN_FOLDER,
  FILES_PICK_FOLDER,
  type OpenFolderAnswer,
} from "../shared/plugin-preload";
import { parseAbsolutePath } from "./ids";

// A bad argument is the Plugin's mistake, and rejects back to its own call.
const Title = z.string().min(1);
const Folder = z.string().transform(parseAbsolutePath);

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
        : { kind: "chosen", path };
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
}
