// Each open Plugin: its UI in one WebContentsView in the Hub window's view stack, and its Backend
// if it has one, kept in line with the lifecycle's snapshots (spec #44, ADRs 0003, 0009). Created
// at open, hidden in the background, destroyed at close. Each open is one Plugin session in
// Diagnostics.

import { join } from "node:path";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import { z } from "zod";
import {
  MessageChannelMain,
  session,
  WebContentsView,
  type BaseWindow,
  type Rectangle,
} from "electron";
import {
  SWITCHER_WIDTH_PX,
  type BusyReason,
  type DisplayLanguage,
  type HubChromeSnapshot,
} from "../shared/hub-chrome-ipc";
import {
  BACKEND_PORT,
  BUSY,
  DISPLAY_LANGUAGE_ARG,
  HAS_BACKEND_ARG,
} from "../shared/plugin-preload";
import { startBackend } from "./backend";
import type { Diagnostics, NetErrorCode, PluginCrash } from "./diagnostics";
import { errorCode } from "./error-code";
import type { AbsolutePath } from "./ids";
import { pluginRefOf, type InstalledPlugin } from "./installed-plugins";
import type { Lifecycle } from "./lifecycle";
import { lockDown } from "./plugin-lockdown";
import { PLUGIN_SCHEME, servePluginUi } from "./plugin-scheme";

// What the preload sends on `BUSY`. An empty reason would show staff nothing, so it is refused. A
// brand cannot be narrowed to, so the `as` after the check is where the type is granted.
const BusyMessage = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("busy"),
    reason: z
      .string()
      .min(1)
      .transform((raw) => raw as BusyReason),
  }),
  z.strictObject({ kind: z.literal("not-busy") }),
]);

/**
 * How long a failed Plugin UI load waits before it is recorded, so a renderer crash that caused it
 * is recorded instead. Probed on Electron 44 (Windows): render-process-gone fired about 12 ms
 * after the load rejected, for a renderer crashed as its page committed.
 */
const LOAD_FAILURE_SETTLE_MS = 500;

export interface PluginViews {
  /** Creates, shows, hides and destroys views until they match `snapshot`. */
  follow(snapshot: HubChromeSnapshot): void;
  /** Lays every view out beside the Plugin Switcher, at the window's current size. */
  layout(): void;
}

interface OpenPlugin {
  view: WebContentsView;
  /** Resolves once the Plugin is closed: its page destroyed and its Backend, if any, exited. */
  closed: Promise<void>;
}

/** The window's whole content area, in its own coordinates. */
export function contentAreaOf(window: BaseWindow): Rectangle {
  // getContentBounds() is in screen coordinates; only its size applies to a child view.
  const { width, height } = window.getContentBounds();
  return { x: 0, y: 0, width, height };
}

export function createPluginViews(
  window: BaseWindow,
  diagnostics: Diagnostics,
  hubDataDir: AbsolutePath,
  /**
   * Told when a Plugin's crash is recorded (`close`: its UI crashed or failed to load, or its
   * Backend broke or failed to start, and the whole Plugin closes), when a closed Plugin is gone
   * (`closed`: its page destroyed and its Backend, if any, exited), and of its page's Busy. Asked
   * for each installed Plugin it opens.
   */
  lifecycle: Pick<Lifecycle, "installed" | "close" | "closed" | "setBusy">,
): PluginViews {
  const opened = new Map<PluginId, OpenPlugin>();

  // Beside the Plugin Switcher.
  const contentArea = (): Rectangle => {
    const { width, height } = contentAreaOf(window);
    return {
      x: SWITCHER_WIDTH_PX,
      y: 0,
      width: width - SWITCHER_WIDTH_PX,
      height,
    };
  };

  // In the Display Language at the time it opens, which it keeps until reopened (ADR 0007).
  const open = (
    plugin: InstalledPlugin,
    displayLanguage: DisplayLanguage,
  ): OpenPlugin => {
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
    const pluginSession = diagnostics.startPluginSession(pluginRefOf(plugin));
    // Records the crash and closes the Plugin, only if this open is still the open one: once it is
    // closing, nothing that follows is a crash, and nothing restarts.
    const crashed = (crash: PluginCrash): void => {
      if (opened.get(id)?.view !== view) return;
      pluginSession.recordCrash(crash);
      lifecycle.close(id);
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
    // `hub.busy`: set with a reason, or cleared. Anything else, an empty reason included, is the
    // Plugin's mistake, and rejects back to its own call.
    view.webContents.ipc.handle(BUSY, (_event, raw: unknown) => {
      const busy = BusyMessage.parse(raw);
      if (opened.get(id)?.view === view) lifecycle.setBusy(id, busy);
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
      // Held, not read from the view later: once the page is destroyed, the view's `webContents`
      // reads undefined (a smoke test crashes a Plugin UI as it loads, before `initialize` answers).
      const { webContents } = view;
      webContents.ipc.once(BACKEND_PORT, () => {
        void backend.initialized.then(() => {
          // ponytail: one port per open; a page that reloads itself loses its Backend. Hand a
          // fresh port per ask if a Plugin ever needs reload.
          if (webContents.isDestroyed()) return;
          const { port1, port2 } = new MessageChannelMain();
          backend.relay(port1);
          webContents.postMessage(BACKEND_PORT, null, [port2]);
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
        // Navigation is locked to this one page, so no later load can fail this way. A renderer
        // that goes away mid-load rejects the load (ERR_FAILED) before render-process-gone fires,
        // so the failure waits: if the crash is recorded meanwhile, `crashed` ignores it.
        const code = netErrorCodeOf(error);
        if (code === "ERR_ABORTED") return;
        setTimeout(() => {
          crashed({
            cause: "failed-to-start",
            exit: { kind: "plugin-ui-load-failed", error: code },
          });
        }, LOAD_FAILURE_SETTLE_MS);
      });
    return { view, closed };
  };

  const close = (id: PluginId, { view, closed }: OpenPlugin): void => {
    opened.delete(id);
    window.contentView.removeChildView(view);
    // Destroys the page; removing the view alone would leak its webContents. On Electron 44 a plain
    // close() destroys it without running pagehide, so the unload handlers are run, and the
    // will-prevent-unload handler above stops any beforeunload from cancelling (probed by hand: a
    // cancelling page still closes in under 100 ms; the smoke suite asserts pagehide).
    view.webContents.close({ waitForBeforeUnload: true });
    void closed.then(() => {
      lifecycle.closed(id);
    });
  };

  return {
    follow({ open: openIds, foreground, content, displayLanguage }) {
      for (const [id, plugin] of opened) {
        if (!openIds.includes(id)) close(id, plugin);
      }
      for (const id of openIds) {
        const openPlugin =
          opened.get(id) ?? open(lifecycle.installed(id), displayLanguage);
        opened.set(id, openPlugin);
        // A hidden view stays alive; Chromium throttles it and the page sees visibilitychange.
        // Hub Settings hide the front one too, so the Hub Chrome beneath draws them.
        openPlugin.view.setVisible(
          id === foreground && content.kind === "plugin",
        );
      }
    },
    layout() {
      for (const { view } of opened.values()) view.setBounds(contentArea());
    },
  };
}

/** The net error a rejected `loadURL` carries: Electron's rejection is an Error with its `code`. */
function netErrorCodeOf(error: unknown): NetErrorCode {
  const code = errorCode(error);
  if (code !== undefined && isNetErrorCode(code)) return code;
  throw new Error("A Plugin UI load failed without a net error code", {
    cause: error,
  });
}

function isNetErrorCode(code: string): code is NetErrorCode {
  return code.startsWith("ERR_");
}
