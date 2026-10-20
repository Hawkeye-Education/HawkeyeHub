// The Hub Chrome's preload: the only door between the Hub Chrome and the main process. Sandboxed, so
// it may import only `electron` (anything else is bundled) and is built as CommonJS.

import { contextBridge, ipcRenderer } from "electron";
import {
  ANSWER_DIALOG,
  CLOSE_PLUGIN,
  EXPORT_DIAGNOSTICS,
  GET_SNAPSHOT,
  OPEN_PLUGIN,
  SHOW_SETTINGS,
  SNAPSHOT_CHANGED,
  type HubChromeApi,
  type HubChromeSnapshot,
} from "../shared/hub-chrome-ipc";

const api: HubChromeApi = {
  subscribe(listener) {
    // The main process is trusted, so its snapshots are not re-validated here.
    ipcRenderer.on(SNAPSHOT_CHANGED, (_event, snapshot: HubChromeSnapshot) => {
      listener(snapshot);
    });
    void ipcRenderer
      .invoke(GET_SNAPSHOT)
      .then((snapshot: HubChromeSnapshot) => {
        listener(snapshot);
      });
  },
  // A rejection means the Hub Chrome asked for something impossible: left unhandled, it is logged
  // in the Hub Chrome's console as the bug it is.
  open(id) {
    void ipcRenderer.invoke(OPEN_PLUGIN, id);
  },
  close(id) {
    void ipcRenderer.invoke(CLOSE_PLUGIN, id);
  },
  answer(answer) {
    void ipcRenderer.invoke(ANSWER_DIALOG, answer);
  },
  showSettings() {
    void ipcRenderer.invoke(SHOW_SETTINGS);
  },
  exportDiagnostics() {
    void ipcRenderer.invoke(EXPORT_DIAGNOSTICS);
  },
};

contextBridge.exposeInMainWorld("hubChrome", api);
