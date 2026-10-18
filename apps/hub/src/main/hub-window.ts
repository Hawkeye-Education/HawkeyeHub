// The Hub's one window: a BaseWindow whose view stack holds the Hub Chrome. Plugin UIs and
// overlays for Hub Chrome dialogs join the same stack later (ADRs 0003, 0006).

import { join } from "node:path";
import { BaseWindow, WebContentsView } from "electron";

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;
const WINDOW_MIN_WIDTH = 960;
const WINDOW_MIN_HEIGHT = 600;

export async function openHubWindow(): Promise<BaseWindow> {
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
  if (devServerUrl === undefined) {
    await hubChrome.webContents.loadFile(
      join(import.meta.dirname, "../renderer/index.html"),
    );
  } else {
    await hubChrome.webContents.loadURL(devServerUrl);
  }
  return window;
}
