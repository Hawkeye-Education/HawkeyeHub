// Each open Plugin: its UI in one WebContentsView in the Hub window's view stack, and its Backend
// if it has one, kept in line with the lifecycle's snapshots (spec #44, ADRs 0003, 0009). Created
// at open, hidden in the background, destroyed at close. Each open is one Plugin session in
// Diagnostics.

import { join } from "node:path";
import {
  MessageChannelMain,
  session,
  WebContentsView,
  type BaseWindow,
} from "electron";
import {
  SWITCHER_WIDTH_PX,
  type DisplayLanguage,
  type HubChromeSnapshot,
} from "../shared/hub-chrome-ipc";
import {
  BACKEND_PORT,
  DISPLAY_LANGUAGE_ARG,
  HAS_BACKEND_ARG,
} from "../shared/plugin-preload";
import { startBackend } from "./backend";
import type { Diagnostics, NetErrorCode, PluginCrash } from "./diagnostics";
import { parsePluginId, parsePluginVersion, type AbsolutePath } from "./ids";
import type { InstalledPlugin } from "./installed-plugins";
import { lockDown } from "./plugin-lockdown";
import { PLUGIN_SCHEME, servePluginUi } from "./plugin-scheme";

export interface PluginViews {
  /** Creates, shows, hides and destroys views until they match `snapshot`. */
  follow(snapshot: HubChromeSnapshot): void;
  /** Lays every view out beside the Plugin Switcher, at the window's current size. */
  layout(): void;
  /**
   * Resolves once every Plugin that has been closed is gone: each page has run its pagehide and
   * each Backend has exited. The Hub quits only then.
   */
  allClosed(): Promise<void>;
}

interface OpenPlugin {
  view: WebContentsView;
  /** Resolves once the Plugin is closed: its page destroyed and its Backend, if any, exited. */
  closed: Promise<void>;
}

export function createPluginViews(
  window: BaseWindow,
  diagnostics: Diagnostics,
  installed: readonly InstalledPlugin[],
  displayLanguage: DisplayLanguage,
  hubDataDir: AbsolutePath,
  /**
   * Called once a Plugin's crash is recorded: its UI crashed or failed to load, or its Backend
   * broke or failed to start. The whole Plugin closes.
   */
  closePlugin: (id: string) => void,
  /** Called once a closed Plugin is gone: its page destroyed and its Backend, if any, exited. */
  pluginClosed: (id: string) => void,
): PluginViews {
  const opened = new Map<string, OpenPlugin>();
  // The closes still under way, by id.
  const closing = new Map<string, Promise<void>>();

  const contentArea = () => {
    // getContentBounds() is in screen coordinates; only its size applies to a child view.
    const { width, height } = window.getContentBounds();
    return {
      x: SWITCHER_WIDTH_PX,
      y: 0,
      width: width - SWITCHER_WIDTH_PX,
      height,
    };
  };

  const open = (plugin: InstalledPlugin): OpenPlugin => {
    const { folder, manifest } = plugin;
    const { id } = manifest;
    const hasBackend = manifest.backend.kind === "python";
    // Keyed by id, never version, so web storage survives updates (ADR 0008).
    const partition = `persist:plugin-${id}`;
    servePluginUi(session.fromPartition(partition), id, join(folder, "ui"));
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Dev mode (#31) turns them back on.
        devTools: false,
        partition,
        preload: join(import.meta.dirname, "../preload/plugin.cjs"),
        additionalArguments: [
          `${DISPLAY_LANGUAGE_ARG}${displayLanguage}`,
          ...(hasBackend ? [HAS_BACKEND_ARG] : []),
        ],
      },
    });
    lockDown(view, window, id);
    const pluginSession = diagnostics.startPluginSession({
      id: parsePluginId(id),
      version: parsePluginVersion(manifest.version),
    });
    // Records the crash and closes the Plugin, only if this open is still the open one: once it is
    // closing, nothing that follows is a crash, and nothing restarts.
    const crashed = (crash: PluginCrash): void => {
      if (opened.get(id)?.view !== view) return;
      pluginSession.recordCrash(crash);
      closePlugin(id);
    };
    view.webContents.on(
      "render-process-gone",
      (_event, { reason, exitCode }) => {
        crashed({
          cause: "crashed",
          exit: { kind: "plugin-ui-gone", exit: { reason, exitCode } },
        });
      },
    );
    view.webContents.on("console-message", ({ level, message }) => {
      pluginSession.recordConsoleMessage(level, message);
    });
    // A Plugin's beforeunload never holds a close (ADR 0009): Busy is how it asks to stay open.
    view.webContents.on("will-prevent-unload", (event) => {
      event.preventDefault();
    });
    // After the page's pagehide and its console messages.
    const destroyed = new Promise<void>((resolve) => {
      view.webContents.once("destroyed", () => {
        resolve();
      });
    });

    // Alongside the Plugin UI load. Null for a UI-only Plugin, which has no Backend.
    const backend = hasBackend
      ? startBackend(plugin, hubDataDir, diagnostics, pluginSession, crashed)
      : null;
    if (backend !== null) {
      // The preload asks for its port as it starts. It gets it once `initialize` has succeeded,
      // and queues the page's requests until then.
      view.webContents.ipc.once(BACKEND_PORT, () => {
        void backend.initialized.then(() => {
          // ponytail: one port per open; a page that reloads itself loses its Backend. Hand a
          // fresh port per ask if a Plugin ever needs reload.
          if (view.webContents.isDestroyed()) return;
          const { port1, port2 } = new MessageChannelMain();
          backend.relay(port1);
          view.webContents.postMessage(BACKEND_PORT, null, [port2]);
        });
      });
    }
    // The Backend gets `shutdown` only once the Plugin UI is gone (spec #44 "Closing").
    const closed = destroyed
      .then(() => backend?.shutdown())
      .then(() => {
        pluginSession.end();
      });

    view.setBounds(contentArea());
    window.contentView.addChildView(view);
    view.webContents
      .loadURL(`${PLUGIN_SCHEME}://${id}/index.html`)
      .catch((error: unknown) => {
        // The first load's main frame failed. A close cuts the load short: that is not a failure.
        // Navigation is locked to this one page, so no later load can fail this way.
        const code = netErrorCodeOf(error);
        if (code === "ERR_ABORTED") return;
        crashed({
          cause: "failed-to-start",
          exit: { kind: "plugin-ui-load-failed", error: code },
        });
      });
    return { view, closed };
  };

  const close = (id: string, { view, closed }: OpenPlugin): void => {
    opened.delete(id);
    window.contentView.removeChildView(view);
    // Destroys the page; removing the view alone would leak its webContents. On Electron 44 a plain
    // close() destroys it without running pagehide, so the unload handlers are run, and the
    // will-prevent-unload handler above stops any beforeunload from cancelling (probed by hand: a
    // cancelling page still closes in under 100 ms; the smoke suite asserts pagehide).
    view.webContents.close({ waitForBeforeUnload: true });
    closing.set(
      id,
      closed.then(() => {
        closing.delete(id);
        pluginClosed(id);
      }),
    );
  };

  return {
    follow({ open: openIds, foreground }) {
      for (const [id, plugin] of opened) {
        if (!openIds.includes(id)) close(id, plugin);
      }
      for (const id of openIds) {
        const plugin = installed.find(({ manifest }) => manifest.id === id);
        if (plugin === undefined)
          throw new Error(`${id} is open but not installed`);
        const openPlugin = opened.get(id) ?? open(plugin);
        opened.set(id, openPlugin);
        // A hidden view stays alive; Chromium throttles it and the page sees visibilitychange.
        openPlugin.view.setVisible(id === foreground);
      }
    },
    layout() {
      for (const { view } of opened.values()) view.setBounds(contentArea());
    },
    async allClosed() {
      await Promise.all(closing.values());
    },
  };
}

/** The net error a rejected `loadURL` carries: Electron's rejection is an Error with its `code`. */
function netErrorCodeOf(error: unknown): NetErrorCode {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    isNetErrorCode(error.code)
  ) {
    return error.code;
  }
  throw new Error("A Plugin UI load failed without a net error code", {
    cause: error,
  });
}

function isNetErrorCode(code: string): code is NetErrorCode {
  return code.startsWith("ERR_");
}
