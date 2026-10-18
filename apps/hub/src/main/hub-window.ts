// The Hub's one window: a BaseWindow whose view stack holds the Hub Chrome. Plugin UIs and
// overlays for Hub Chrome dialogs join the same stack later (ADRs 0003, 0006).

import { join } from "node:path";
import { app, BaseWindow, dialog, WebContentsView } from "electron";
import type { Diagnostics, DisplayLanguage } from "./diagnostics";
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

function isCutShort(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    CUT_SHORT_LOAD_CODES.has(error.code)
  );
}

export function openHubWindow(
  diagnostics: Diagnostics,
  now: () => Date,
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

  // These are Electron's defaults; they are spelled out because the Hub Chrome must never have
  // Node access. No preload until a Hub Chrome feature needs IPC.
  const hubChrome = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.contentView.addChildView(hubChrome);
  // ADR 0012: a crashed Hub Chrome is logged and reloaded in place, until it keeps crashing.
  // Then the Hub gives up, says so in a native box (the Hub Chrome cannot draw one) and quits.
  const recordCrash = countHubChromeCrashes(now);
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
      // en-HK until the Display Language setting exists; its ticket wires this box up.
      const text = STOPPED_UNEXPECTEDLY["en-HK"];
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
    // getContentBounds() is in screen coordinates; only its size applies to a child view.
    const { width, height } = window.getContentBounds();
    hubChrome.setBounds({ x: 0, y: 0, width, height });
  };
  fillContentArea();
  window.on("resize", fillContentArea);
  // A BaseWindow does not destroy its views' webContents.
  window.on("closed", () => {
    hubChrome.webContents.close();
  });

  // Set only by `electron-vite dev`; absent in the built Hub.
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  const load =
    devServerUrl === undefined
      ? hubChrome.webContents.loadFile(
          join(import.meta.dirname, "../renderer/index.html"),
        )
      : hubChrome.webContents.loadURL(devServerUrl);
  load.catch((error: unknown) => {
    // A load cut short is not a Hub crash, so it is swallowed. Rethrowing anything else, such as a
    // broken install's ERR_FILE_NOT_FOUND, makes it an unhandled rejection that crashes the Hub.
    if (!isCutShort(error)) throw error;
  });
  return window;
}
