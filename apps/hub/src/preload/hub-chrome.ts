// The Hub Chrome's preload: the only door between the Hub Chrome and the main process. Sandboxed, so
// it may import only `electron` (anything else is bundled) and is built as CommonJS.

import { contextBridge, ipcRenderer } from "electron";
import {
  ANSWER_DIALOG,
  CANCEL_SETTINGS,
  CLOSE_PLUGIN,
  EDIT_SETTINGS,
  EXPORT_DIAGNOSTICS,
  GET_SNAPSHOT,
  INSTALL_PLUGIN,
  OPEN_PLUGIN,
  RETRY_REGISTRY,
  SAVE_SETTINGS,
  SHOW_CATALOGUE,
  SHOW_SETTINGS,
  SNAPSHOT_CHANGED,
  TYPE_AI_KEY,
  UNINSTALL_PLUGIN,
  TOGGLE_ASSISTANT,
  SEND_TO_ASSISTANT,
  STOP_ASSISTANT,
  NEW_CONVERSATION,
  CHOOSE_MODEL,
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
  editSettings(form) {
    void ipcRenderer.invoke(EDIT_SETTINGS, form);
  },
  typeAiKey(row, key) {
    void ipcRenderer.invoke(TYPE_AI_KEY, row, key);
  },
  saveSettings() {
    void ipcRenderer.invoke(SAVE_SETTINGS);
  },
  cancelSettings() {
    void ipcRenderer.invoke(CANCEL_SETTINGS);
  },
  exportDiagnostics() {
    void ipcRenderer.invoke(EXPORT_DIAGNOSTICS);
  },
  showCatalogue() {
    void ipcRenderer.invoke(SHOW_CATALOGUE);
  },
  retryRegistry() {
    void ipcRenderer.invoke(RETRY_REGISTRY);
  },
  install(id) {
    void ipcRenderer.invoke(INSTALL_PLUGIN, id);
  },
  uninstall(id) {
    void ipcRenderer.invoke(UNINSTALL_PLUGIN, id);
  },
  toggleAssistant(id) {
    void ipcRenderer.invoke(TOGGLE_ASSISTANT, id);
  },
  sendToAssistant(id, content) {
    void ipcRenderer.invoke(SEND_TO_ASSISTANT, id, content);
  },
  stopAssistant(id) {
    void ipcRenderer.invoke(STOP_ASSISTANT, id);
  },
  newConversation(id) {
    void ipcRenderer.invoke(NEW_CONVERSATION, id);
  },
  chooseModel(id, model) {
    void ipcRenderer.invoke(CHOOSE_MODEL, id, model);
  },
};

contextBridge.exposeInMainWorld("hubChrome", api);
