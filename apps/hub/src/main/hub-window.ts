// The Hub's one window: a BaseWindow whose view stack holds the Hub Chrome, with the open Plugin
// UIs above it, and, only while a Hub Chrome dialog is showing, the dialog overlay above them all:
// a second Hub Chrome view (ADRs 0003, 0006).

import { join } from "node:path";
import { PluginId } from "@hawkeye-hub/plugin-format";
import {
  app,
  BaseWindow,
  dialog,
  ipcMain,
  WebContentsView,
  type WebContents,
} from "electron";
import {
  ANSWER_DIALOG,
  CANCEL_SETTINGS,
  CLOSE_PLUGIN,
  DIALOG_ANSWERS,
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
  type DisplayLanguage,
  type HubChromeDialog,
} from "../shared/hub-chrome-ipc";
import { AiContentSchema, AiModelChoiceSchema } from "../shared/ai-call";
import { z } from "zod";
import { bundleFileName, type Diagnostics } from "./diagnostics";
import { errorCode } from "./error-code";
import {
  AiProviderRowSchema,
  HubSettingsFormSchema,
} from "../shared/hub-settings";
import { parseAiProviderKey } from "./ai-keys";
import type { HubMode } from "./hub-mode";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import type { Lifecycle } from "./lifecycle";
import { contentAreaOf, createPluginViews } from "./plugin-views";
import {
  countHubChromeCrashes,
  HUB_CHROME_CRASH_WINDOW_SECONDS,
  HUB_CHROME_MAX_CRASHES,
} from "./hub-chrome-crashes";

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;
const WINDOW_MIN_WIDTH = 960;
const WINDOW_MIN_HEIGHT = 600;

// The error codes Electron rejects a load with when it is cut short, by the window closing or by
// the Hub Chrome crashing mid-load (it then reloads), rather than failing.
const CUT_SHORT_LOAD_CODES = new Set(["ERR_ABORTED", "ERR_FAILED"]);

// The box shown when the Hub gives up on a Hub Chrome that keeps crashing (ADR 0012).
const STOPPED_UNEXPECTEDLY = {
  "en-HK": {
    message: "Hawkeye Hub stopped unexpectedly",
    detail: "Its window kept crashing.",
    quit: "Quit",
  },
  "zh-HK": {
    message: "Hawkeye Hub 意外停止運作",
    detail: "其視窗不斷當機。",
    quit: "結束",
  },
} satisfies Record<DisplayLanguage, unknown>;

const DialogAnswer = z.enum(DIALOG_ANSWERS);

function isCutShort(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && CUT_SHORT_LOAD_CODES.has(code);
}

// These are Electron's defaults; they are spelled out because no Hub Chrome view may ever have
// Node access. Its preload is its only way to the main process.
function hubChromeView(): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Not a default: the Hub Chrome has no DevTools, even in dev mode, which gives them only
      // to Plugin UIs (#31).
      devTools: false,
      preload: join(import.meta.dirname, "../preload/hub-chrome.cjs"),
    },
  });
}

/** Loads the Hub Chrome page: the Hub Chrome itself, or with `#dialog` the dialog overlay. */
function loadHubChrome(contents: WebContents, hash: "dialog" | null): void {
  // Set only by `electron-vite dev`; absent in the built Hub.
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  const page = join(import.meta.dirname, "../renderer/index.html");
  const load =
    devServerUrl === undefined
      ? contents.loadFile(page, hash === null ? {} : { hash })
      : contents.loadURL(
          hash === null ? devServerUrl : `${devServerUrl}#${hash}`,
        );
  load.catch((error: unknown) => {
    // A load cut short is not a Hub crash, so it is swallowed. Rethrowing anything else, such as a
    // broken install's ERR_FILE_NOT_FOUND, makes it an unhandled rejection that crashes the Hub.
    if (!isCutShort(error)) throw error;
  });
}

export function openHubWindow(
  diagnostics: Diagnostics,
  now: () => Date,
  lifecycle: Lifecycle,
  hubDataDir: AbsolutePath,
  mode: HubMode["kind"],
): BaseWindow {
  // Native frame and title bar until the Theme brings the Hub Chrome's own (ADR 0006).
  // Size and position are not remembered.
  const window = new BaseWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    center: true,
    // A BaseWindow does not take its title from the page.
    title: "Hawkeye Hub",
  });

  const hubChrome = hubChromeView();
  window.contentView.addChildView(hubChrome);
  // Above the Hub Chrome in the view stack, beside the Plugin Switcher.
  const pluginViews = createPluginViews(
    window,
    diagnostics,
    hubDataDir,
    lifecycle,
    mode,
  );
  // The dialog overlay, while a dialog is showing: the whole window, so nothing beneath takes a
  // click, and transparent but for the dialog it draws. Null while no dialog is showing.
  let overlay: WebContentsView | null = null;
  const followDialog = (pending: HubChromeDialog | null): void => {
    if (pending !== null && overlay === null) {
      const view = hubChromeView();
      view.setBackgroundColor("#00000000");
      view.setBounds(contentAreaOf(window));
      // Added last, so above every Plugin UI.
      window.contentView.addChildView(view);
      // ponytail: a crashed overlay reloads without counting towards giving up; count it with
      // the Hub Chrome's crashes if it ever crashes often.
      view.webContents.on("render-process-gone", () => {
        view.webContents.reload();
      });
      loadHubChrome(view.webContents, "dialog");
      // Keys go to the dialog: Enter and Esc answer it.
      view.webContents.focus();
      overlay = view;
    } else if (pending === null && overlay !== null) {
      window.contentView.removeChildView(overlay);
      overlay.webContents.close();
      overlay = null;
    }
  };
  // Both Hub Chrome views draw snapshots of the lifecycle state held here: each fetches one on
  // every load, reloads included, and is sent a new one on every change. Their requests are
  // invoked, so a bad one rejects back to its view rather than throwing in the main process.
  const fromHubChrome = (channel: string, sender: WebContents): void => {
    if (sender !== hubChrome.webContents && sender !== overlay?.webContents) {
      throw new Error(`${channel} is only for the Hub Chrome`);
    }
  };
  ipcMain.handle(GET_SNAPSHOT, (event) => {
    fromHubChrome(GET_SNAPSHOT, event.sender);
    return lifecycle.snapshot();
  });
  ipcMain.handle(OPEN_PLUGIN, (event, id: unknown) => {
    fromHubChrome(OPEN_PLUGIN, event.sender);
    lifecycle.open(PluginId.parse(id));
  });
  ipcMain.handle(CLOSE_PLUGIN, (event, id: unknown) => {
    fromHubChrome(CLOSE_PLUGIN, event.sender);
    lifecycle.requestClose(PluginId.parse(id));
  });
  ipcMain.handle(ANSWER_DIALOG, (event, answer: unknown) => {
    fromHubChrome(ANSWER_DIALOG, event.sender);
    lifecycle.answer(DialogAnswer.parse(answer));
  });
  ipcMain.handle(SHOW_SETTINGS, (event) => {
    fromHubChrome(SHOW_SETTINGS, event.sender);
    lifecycle.showSettings();
  });
  ipcMain.handle(EDIT_SETTINGS, (event, form: unknown) => {
    fromHubChrome(EDIT_SETTINGS, event.sender);
    lifecycle.editSettings(HubSettingsFormSchema.parse(form));
  });
  ipcMain.handle(TYPE_AI_KEY, (event, row: unknown, key: unknown) => {
    fromHubChrome(TYPE_AI_KEY, event.sender);
    lifecycle.typeAiKey(
      AiProviderRowSchema.parse(row),
      parseAiProviderKey(z.string().parse(key)),
    );
  });
  ipcMain.handle(SAVE_SETTINGS, (event) => {
    fromHubChrome(SAVE_SETTINGS, event.sender);
    lifecycle.saveSettings();
  });
  ipcMain.handle(CANCEL_SETTINGS, (event) => {
    fromHubChrome(CANCEL_SETTINGS, event.sender);
    lifecycle.cancelSettings();
  });
  ipcMain.handle(SHOW_CATALOGUE, (event) => {
    fromHubChrome(SHOW_CATALOGUE, event.sender);
    lifecycle.showCatalogue();
  });
  ipcMain.handle(RETRY_REGISTRY, (event) => {
    fromHubChrome(RETRY_REGISTRY, event.sender);
    lifecycle.retryRegistry();
  });
  ipcMain.handle(INSTALL_PLUGIN, (event, id: unknown) => {
    fromHubChrome(INSTALL_PLUGIN, event.sender);
    lifecycle.install(PluginId.parse(id));
  });
  ipcMain.handle(UNINSTALL_PLUGIN, (event, id: unknown) => {
    fromHubChrome(UNINSTALL_PLUGIN, event.sender);
    lifecycle.uninstall(PluginId.parse(id));
  });
  ipcMain.handle(TOGGLE_ASSISTANT, (event, id: unknown) => {
    fromHubChrome(TOGGLE_ASSISTANT, event.sender);
    lifecycle.toggleAssistant(PluginId.parse(id));
  });
  ipcMain.handle(SEND_TO_ASSISTANT, (event, id: unknown, content: unknown) => {
    fromHubChrome(SEND_TO_ASSISTANT, event.sender);
    lifecycle.sendToAssistant(
      PluginId.parse(id),
      AiContentSchema.parse(content),
    );
  });
  ipcMain.handle(STOP_ASSISTANT, (event, id: unknown) => {
    fromHubChrome(STOP_ASSISTANT, event.sender);
    lifecycle.stopAssistant(PluginId.parse(id));
  });
  ipcMain.handle(NEW_CONVERSATION, (event, id: unknown) => {
    fromHubChrome(NEW_CONVERSATION, event.sender);
    lifecycle.newConversation(PluginId.parse(id));
  });
  ipcMain.handle(CHOOSE_MODEL, (event, id: unknown, model: unknown) => {
    fromHubChrome(CHOOSE_MODEL, event.sender);
    lifecycle.chooseModel(PluginId.parse(id), AiModelChoiceSchema.parse(model));
  });
  ipcMain.handle(EXPORT_DIAGNOSTICS, async (event) => {
    fromHubChrome(EXPORT_DIAGNOSTICS, event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      defaultPath: join(app.getPath("downloads"), bundleFileName(now())),
    });
    if (canceled) return;
    diagnostics.exportBundle(
      parseAbsolutePath(filePath),
      lifecycle.systemDescription({
        name: process.platform,
        version: process.getSystemVersion(),
        arch: process.arch,
      }),
    );
  });
  // Quitting (a window close, or app.quit as Cmd+Q does, which closes the window) asks first if any
  // Plugin is Busy, and **Keep open** cancels it. Then every open Plugin closes, in parallel. Their
  // pages unload and their Backends exit asynchronously, and the Hub exits as soon as the window
  // has closed, so the window waits until none is open or closing, including Plugins already
  // closing before the quit.
  let quit: "not-quitting" | "closing-plugins" | "plugins-closed" =
    "not-quitting";
  const closeWindowOncePluginsGone = (): void => {
    const { open, closing } = lifecycle.snapshot();
    if (quit !== "closing-plugins" || open.length > 0 || closing.length > 0)
      return;
    quit = "plugins-closed";
    // Not from inside the window's own close handler, or a lifecycle listener.
    queueMicrotask(() => {
      window.close();
    });
  };
  const closePluginsThenWindow = (): void => {
    quit = "closing-plugins";
    for (const id of lifecycle.snapshot().open) lifecycle.close(id);
    closeWindowOncePluginsGone();
  };
  lifecycle.onChange(() => {
    const snapshot = lifecycle.snapshot();
    pluginViews.follow(snapshot);
    followDialog(snapshot.dialog);
    hubChrome.webContents.send(SNAPSHOT_CHANGED, snapshot);
    overlay?.webContents.send(SNAPSHOT_CHANGED, snapshot);
    closeWindowOncePluginsGone();
  });
  // ADR 0012: a crashed Hub Chrome is logged and reloaded in place, until it keeps crashing.
  // Then the Hub gives up, says so in a native box (the Hub Chrome cannot draw one) and quits.
  const recordCrash = countHubChromeCrashes(now);
  // Set once the Hub has given up on the Hub Chrome: its quit skips the Busy confirmation, since
  // there is no Hub Chrome to draw it.
  let gaveUp = false;
  hubChrome.webContents.on(
    "render-process-gone",
    (_event, { reason, exitCode }) => {
      diagnostics.recordHubEvent({
        kind: "hub-chrome-renderer-gone",
        exit: { reason, exitCode },
      });
      if (recordCrash() === "reload") {
        hubChrome.webContents.reload();
        return;
      }
      diagnostics.recordHubEvent({
        kind: "hub-chrome-kept-crashing",
        crashes: HUB_CHROME_MAX_CRASHES,
        withinSeconds: HUB_CHROME_CRASH_WINDOW_SECONDS,
      });
      gaveUp = true;
      const text = STOPPED_UNEXPECTEDLY[lifecycle.snapshot().displayLanguage];
      // The main process is healthy, so a normal quit, which logs "Hub closing".
      void dialog
        .showMessageBox(window, {
          type: "error",
          message: text.message,
          detail: text.detail,
          buttons: [text.quit],
        })
        .then(() => {
          app.quit();
        });
    },
  );

  const fillContentArea = (): void => {
    hubChrome.setBounds(contentAreaOf(window));
    overlay?.setBounds(contentAreaOf(window));
    pluginViews.layout();
  };
  fillContentArea();
  window.on("resize", fillContentArea);
  window.on("close", (event) => {
    if (quit === "plugins-closed") return;
    event.preventDefault();
    // Already closing them: the window closes once they are gone.
    if (quit === "closing-plugins") return;
    if (gaveUp) closePluginsThenWindow();
    else lifecycle.requestQuit(closePluginsThenWindow);
  });
  // A BaseWindow does not destroy its views' webContents.
  window.on("closed", () => {
    hubChrome.webContents.close();
    overlay?.webContents.close();
  });

  loadHubChrome(hubChrome.webContents, null);
  return window;
}
