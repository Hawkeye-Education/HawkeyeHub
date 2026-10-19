// The Hub Chrome's preload: the only door between the Hub Chrome and the main process. Sandboxed, so
// it may import only `electron` (anything else is bundled) and is built as CommonJS.

import { contextBridge, ipcRenderer } from "electron";
import {
  GET_SNAPSHOT,
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
};

contextBridge.exposeInMainWorld("hubChrome", api);
