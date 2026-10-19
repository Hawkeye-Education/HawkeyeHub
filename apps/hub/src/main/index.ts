// The Hub's main process. The order below matters: each step relies on the ones before it.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, Menu } from "electron";
import { openDiagnostics } from "./diagnostics";
import { displayLanguageFor } from "./display-language";
import { openHubWindow } from "./hub-window";
import { parseAbsolutePath } from "./ids";
import { loadInstalledPlugins } from "./installed-plugins";
import { createLifecycle } from "./lifecycle";

// 1. On-disk location, before anything reads or writes a path. The single-instance lock lives
// in userData, and getPath("logs") creates the default folder, so both must move first.
// Absence of the variable is a real state: the Hub then uses Electron's defaults for the OS user.
const dataDirRaw = process.env["HAWKEYE_HUB_DATA_DIR"];
if (dataDirRaw !== undefined) {
  const dataDir = parseAbsolutePath(dataDirRaw);
  const userData = join(dataDir, "user-data");
  // setPath throws on a folder that does not exist.
  mkdirSync(userData, { recursive: true });
  app.setPath("userData", userData);
  // --user-data-dir alone would leave the logs in ~/Library/Logs on macOS.
  app.setAppLogsPath(join(dataDir, "logs"));
}
// The Hub's data folder: installed Plugins now, Plugin Data and Shared Stores later. With no
// variable it is Electron's userData for the OS user.
const hubDataDir = parseAbsolutePath(dataDirRaw ?? app.getPath("userData"));

// 2. The single-instance lock, keyed on userData. A launch that fails to take it quits before
// Diagnostics opens or any handler is registered, so it logs nothing. The running Hub hears of it
// through second-instance and brings its window forward.
if (app.requestSingleInstanceLock()) {
  runHub();
} else {
  app.quit();
}

function runHub(): void {
  // 3. Diagnostics on the logs path, which step 1 may have moved.
  const now = (): Date => new Date();
  const diagnostics = openDiagnostics(
    parseAbsolutePath(app.getPath("logs")),
    now,
  );
  diagnostics.recordHubEvent({ kind: "hub-opened" });
  // A crash is logged synchronously, then the Hub exits at once: after an uncaught error its
  // state is unknown, so it does not run will-quit and log "Hub closing". There is no clean-exit
  // marker and no prompt about the crash on the next start (ADR 0012). Electron's main process only
  // warns about an unhandled rejection, so it needs its own listener.
  const logCrashAndExit = (
    error: unknown,
    origin: NodeJS.UncaughtExceptionOrigin,
  ): void => {
    diagnostics.recordHubEvent({ kind: "uncaught-exception", origin, error });
    app.exit(1);
  };
  process.on("uncaughtException", logCrashAndExit);
  process.on("unhandledRejection", (reason) => {
    logCrashAndExit(reason, "unhandledRejection");
  });
  // will-quit fires once all windows have closed, however the quit began; `once` keeps it to one line.
  app.once("will-quit", () => {
    diagnostics.recordHubEvent({ kind: "hub-closing" });
  });

  // Closing the window quits the Hub on every platform, macOS included: there is no Dock-only state.
  app.on("window-all-closed", () => {
    app.quit();
  });

  // Not a top-level await: Electron holds `ready` back until an ESM main module has finished
  // evaluating, so awaiting it here would never resolve. A rejection is an unhandled one, which
  // the listener above logs before the Hub exits.
  const hubWindow = app.whenReady().then(() => {
    // Windows: no menu bar. macOS: only the app and Edit menus, for Cmd+Q and the clipboard
    // shortcuts. Either way the default menu, and its Toggle Developer Tools item, is gone.
    Menu.setApplicationMenu(
      process.platform === "darwin"
        ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }])
        : null,
    );
    // Here, not before `ready`: a record that does not parse throws, and a throw in this callback
    // is an unhandled rejection, which the listener above logs as a Hub crash.
    const installed = loadInstalledPlugins(hubDataDir);
    for (const { plugin, reason } of installed.leftOut) {
      diagnostics.recordHubEvent({ kind: "plugin-left-out", plugin, reason });
    }
    const lifecycle = createLifecycle(
      displayLanguageFor(app.getPreferredSystemLanguages()),
      installed.loaded,
    );
    return openHubWindow(diagnostics, now, lifecycle);
  });

  // Registered now, not once the window is open, so a launch during startup is not missed: it
  // brings the window forward as soon as there is one.
  app.on("second-instance", () => {
    void hubWindow.then((window) => {
      if (window.isMinimized()) window.restore();
      window.focus();
    });
  });
}
