// The Hub's main process. The order below matters: each step relies on the ones before it.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, Menu } from "electron";
import { openDiagnostics } from "./diagnostics";
import { openHubWindow } from "./hub-window";
import { parseAbsolutePath } from "./ids";

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
  const diagnostics = openDiagnostics(
    parseAbsolutePath(app.getPath("logs")),
    () => new Date(),
  );
  diagnostics.recordHubEvent({ kind: "hub-opened" });
  // A crash is logged synchronously, then the Hub exits at once: after an uncaught error its
  // state is unknown, so it does not run will-quit and log "Hub closing". There is no clean-exit
  // marker and no prompt about the crash on the next start (ADR 0012). A rejection gets its own
  // listener, so Node does not also raise it as an uncaught exception.
  const crash = (
    origin: NodeJS.UncaughtExceptionOrigin,
    error: unknown,
  ): void => {
    diagnostics.recordHubEvent({ kind: "uncaught-exception", origin, error });
    app.exit(1);
  };
  process.on("uncaughtException", (error, origin) => {
    crash(origin, error);
  });
  process.on("unhandledRejection", (reason) => {
    crash("unhandledRejection", reason);
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
    return openHubWindow(diagnostics);
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
