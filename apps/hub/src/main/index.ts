// The Hub's main process. The order below matters: each step relies on the ones before it.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  app,
  Menu,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  session,
} from "electron";
import { startAiChat } from "./ai";
import { keysAfterSave, loadAiKeys, saveAiKeys } from "./ai-keys";
import { assistantContext } from "./assistant-context";
import { aiCallDeps } from "./plugin-views";
import { killBackendsNow } from "./backend";
import { openDiagnostics } from "./diagnostics";
import { displayLanguageFor } from "./display-language";
import { loadHubSettings, saveHubSettings } from "./hub-settings";
import { openHubWindow } from "./hub-window";
import { parseAbsolutePath, parseHubVersion } from "./ids";
import { parseHubMode } from "./hub-mode";
import {
  loadDevPlugins,
  loadInstalledPlugins,
  pluginRefOf,
  sweepLeftovers,
  type InstalledPlugin,
} from "./installed-plugins";
import { createJobQueue } from "./job-queue";
import { createLifecycle } from "./lifecycle";
import { installPlugin } from "./plugin-install";
import { uninstallPlugin, type UninstallData } from "./plugin-uninstall";
import { createUpdater } from "./plugin-update";
import type { HubSettings } from "../shared/hub-settings";
import { HUB_API_VERSION } from "./hub-api-version";
import { PLUGIN_ICON_SCHEME, servePluginIcons } from "./plugin-icons";
import {
  checkRegistry,
  REGISTRY_CHECK_INTERVAL_MS,
  registryUrlFrom,
  type HostPlatform,
  type RegistryFetch,
  type RegistryPlugin,
  type WebUrl,
} from "./registry";
import { PLUGIN_SCHEME } from "./plugin-scheme";
import { createUv } from "./uv";
import type { PluginId } from "@hawkeye-hub/plugin-format";

// 0. Installed, or dev mode (PLUGIN_STANDARD §9.4). Dev mode's Plugins are loaded here, so a bad
// one stops the Hub before it opens, with why printed in the terminal. Nothing is open yet to log
// to, so the catch prints and exits rather than letting Electron show its error dialog.
// The Plugins dev mode loaded ride along in its variant.
let startedAs:
  { kind: "installed" } | { kind: "dev"; plugins: InstalledPlugin[] };
try {
  const hubMode = parseHubMode(
    process.argv,
    app.isPackaged,
    parseAbsolutePath(process.cwd()),
  );
  startedAs =
    hubMode.kind === "dev"
      ? {
          kind: "dev",
          plugins: loadDevPlugins(hubMode.pluginsDir, hubMode.ids),
        }
      : hubMode;
} catch (error) {
  console.error(
    `Hawkeye Hub dev mode: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

// 1. On-disk location, before anything reads or writes a path. The single-instance lock lives
// in userData, and getPath("logs") creates the default folder, so both must move first.
// Absence of the variable is a real state: the Hub then uses Electron's defaults for the OS user,
// or in dev mode its own folder, so dev data never mixes with an installed Hub's.
const dataDirRaw = process.env["HAWKEYE_HUB_DATA_DIR"];
if (dataDirRaw !== undefined) {
  const dataDir = parseAbsolutePath(dataDirRaw);
  const userData = join(dataDir, "user-data");
  // setPath throws on a folder that does not exist.
  mkdirSync(userData, { recursive: true });
  app.setPath("userData", userData);
  // --user-data-dir alone would leave the logs in ~/Library/Logs on macOS.
  app.setAppLogsPath(join(dataDir, "logs"));
} else if (startedAs.kind === "dev") {
  const userData = join(app.getPath("appData"), "Hawkeye Hub Dev");
  mkdirSync(userData, { recursive: true });
  app.setPath("userData", userData);
  app.setAppLogsPath(join(userData, "logs"));
}
// The Hub's data folder: installed Plugins now, Plugin Data and Shared Stores later. With no
// variable it is Electron's userData, as moved above.
const hubDataDir = parseAbsolutePath(dataDirRaw ?? app.getPath("userData"));

// Privileges are granted once, before `ready`, for every scheme the Hub serves: a second call
// replaces the first. The icon scheme is standard (host and path), secure, and CORS-enabled: CSS
// masks fetch in CORS mode. The Plugin UI scheme is standard and secure, so each Plugin UI has its
// own origin and relative URLs, and its pages may use fetch.
protocol.registerSchemesAsPrivileged([
  {
    scheme: PLUGIN_ICON_SCHEME,
    privileges: { standard: true, secure: true, corsEnabled: true },
  },
  {
    scheme: PLUGIN_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

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
    // No Backend, or child it launched, outlives the Hub (ADR 0003). The Hub exits even if a kill
    // throws; the stdin rule covers what the kill missed.
    try {
      killBackendsNow();
    } finally {
      app.exit(1);
    }
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
    // is an unhandled rejection, which the listener above logs as a Hub crash. Dev mode never
    // reads or writes the record, so it never sweeps. The sweep runs before loading (spec #91).
    if (startedAs.kind === "installed") {
      for (const { plugin, partial } of sweepLeftovers(hubDataDir)) {
        diagnostics.recordHubEvent({ kind: "plugin-swept", plugin, partial });
      }
    }
    const installed =
      startedAs.kind === "dev"
        ? { loaded: startedAs.plugins, leftOut: [] }
        : loadInstalledPlugins(hubDataDir);
    for (const { plugin, reason } of installed.leftOut) {
      diagnostics.recordHubEvent({ kind: "plugin-left-out", plugin, reason });
    }
    // Electron's fetch, through the OS's proxy settings, as schools need.
    const fetchFromWeb: RegistryFetch = (url, init) => net.fetch(url, init);
    const platform: HostPlatform = `${process.platform}-${process.arch}`;
    // uv for Python Backends, downloaded with the first one (ADR 0011).
    const uv = createUv({ dataDir: hubDataDir, fetch: fetchFromWeb, platform });
    // The Registry's icon of each Plugin the latest Registry check offered.
    let registryIcons: ReadonlyMap<PluginId, WebUrl> = new Map();
    // The Hub Chrome has no partition, so its session is the default one.
    session.defaultSession.protocol.handle(
      PLUGIN_ICON_SCHEME,
      servePluginIcons(
        // Read on each request, after the lifecycle exists: an install adds to it.
        () =>
          lifecycle.snapshot().plugins.map(({ id }) => lifecycle.installed(id)),
        () => registryIcons,
        fetchFromWeb,
      ),
    );
    // The Colour Scheme drives `prefers-color-scheme` in every view (ADR 0006), so it is applied
    // before the window opens, and again on every Save.
    const applyColourScheme = ({ colourScheme }: HubSettings): void => {
      nativeTheme.themeSource = colourScheme;
    };
    const settings = loadHubSettings(hubDataDir, diagnostics);
    applyColourScheme(settings);
    // Parsed here, so a bad HAWKEYE_HUB_REGISTRY_URL is logged as a crash. Only an installed Hub
    // checks it.
    const registryUrl = registryUrlFrom(process.env);
    // One failed check is one `registry-check-failed` line; installed Plugins are left alone.
    // ponytail: two checks in flight answer in whatever order they finish; drop a stale answer if
    // a hung check ever outlives the next one.
    const checkRegistryNow = (): void => {
      void checkRegistry({
        url: registryUrl,
        fetch: fetchFromWeb,
        platform,
        hubApiVersion: HUB_API_VERSION,
      }).then((check) => {
        if (check.kind === "failed") {
          diagnostics.recordHubEvent({
            kind: "registry-check-failed",
            failure: check.failure,
          });
        } else {
          registryIcons = new Map(
            check.plugins.map(({ manifest, iconUrl }) => [
              manifest.id,
              iconUrl,
            ]),
          );
        }
        lifecycle.registryChecked(check);
        // A throw is an unhandled rejection: a Hub crash, as with installs.
        void updater.registryChecked(check);
      });
    };
    // Installs, updates and uninstalls run one at a time (spec #91). A job that throws,
    // rather than answering a failure cause, is an unhandled rejection: a Hub crash.
    const jobs = createJobQueue();
    const installNow = (plugin: RegistryPlugin): void => {
      void jobs
        .run(() =>
          installPlugin(
            { dataDir: hubDataDir, fetch: fetchFromWeb, uv },
            plugin,
          ),
        )
        .then((outcome) => {
          if (outcome.kind === "failed") {
            const { kind: _failed, ...failure } = outcome;
            diagnostics.recordHubEvent({
              kind: "plugin-install-failed",
              plugin: pluginRefOf(plugin),
              ...failure,
            });
          }
          lifecycle.installFinished(plugin.manifest.id, outcome);
        });
    };
    // The partition plugin-views opens the Plugin in.
    const partitionOf = (id: PluginId) =>
      session.fromPartition(`persist:plugin-${id}`);
    const uninstallNow = (
      plugin: InstalledPlugin,
      data: UninstallData,
    ): void => {
      const { id } = plugin.manifest;
      void jobs
        .run(() =>
          uninstallPlugin(
            {
              dataDir: hubDataDir,
              uv,
              clearPartition: (cleared) =>
                partitionOf(cleared).clearStorageData(),
            },
            plugin,
            data,
          ),
        )
        .then(() => {
          lifecycle.uninstallFinished(id);
        });
    };
    const lifecycle = createLifecycle({
      // package.json's `version`: without one Electron would answer its own version.
      hubVersion: parseHubVersion(app.getVersion()),
      systemLanguage: displayLanguageFor(app.getPreferredSystemLanguages()),
      installed: installed.loaded,
      storedAtStart: settings,
      keyedAtStart: new Set(loadAiKeys(hubDataDir, safeStorage).keys()),
      save: (saved, providerKeys) => {
        const storedKeys = loadAiKeys(hubDataDir, safeStorage);
        const keys = keysAfterSave(storedKeys, providerKeys);
        // Written only when a key changed: safeStorage's own key reaches disk only some time after
        // first use (seen: a Hub killed after a Save could not decrypt the file on its next start).
        if (!isDeepStrictEqual(keys, storedKeys)) {
          saveAiKeys(hubDataDir, safeStorage, keys);
        }
        saveHubSettings(hubDataDir, saved);
        applyColourScheme(saved);
        return new Set(keys.keys());
      },
      unknownTheme: (name) => {
        diagnostics.recordHubEvent({ kind: "theme-unknown", name });
      },
      // With the Hub Settings and keys saved when each chat starts, as `hub.ai`'s are.
      assistant: {
        context: ({ folder }, language) => assistantContext(folder, language),
        chat: (request) =>
          startAiChat(
            aiCallDeps(hubDataDir, diagnostics, lifecycle.storedSettings()),
            request,
          ),
      },
      // Dev mode runs no Registry checks (PLUGIN_STANDARD §9.4).
      registry:
        startedAs.kind === "dev"
          ? { kind: "off" }
          : {
              kind: "on",
              check: checkRegistryNow,
              install: installNow,
              uninstall: uninstallNow,
            },
    });
    // Silent updates after each check, through the same job queue (spec #91).
    const updater = createUpdater({
      dataDir: hubDataDir,
      fetch: fetchFromWeb,
      uv,
      jobs,
      lifecycle,
      updateFailed: (failure) => {
        diagnostics.recordHubEvent({
          kind: "plugin-update-failed",
          ...failure,
        });
      },
    });
    // At launch and every 4 hours (spec #91); Retry checks through the lifecycle too.
    if (startedAs.kind === "installed") {
      checkRegistryNow();
      setInterval(checkRegistryNow, REGISTRY_CHECK_INTERVAL_MS);
    }
    return openHubWindow(
      diagnostics,
      now,
      lifecycle,
      hubDataDir,
      startedAs.kind,
    );
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
