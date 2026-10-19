// Each open Plugin's UI: one WebContentsView in the Hub window's view stack, kept in line with the
// lifecycle's snapshots (spec #44, ADRs 0003, 0009). Created at open, hidden in the background,
// destroyed at close. Each open is one Plugin session in Diagnostics.

import { join } from "node:path";
import { session, WebContentsView, type BaseWindow } from "electron";
import {
  SWITCHER_WIDTH_PX,
  type DisplayLanguage,
  type HubChromeSnapshot,
} from "../shared/hub-chrome-ipc";
import { DISPLAY_LANGUAGE_ARG } from "../shared/plugin-preload";
import type { Diagnostics } from "./diagnostics";
import { parsePluginId, parsePluginVersion } from "./ids";
import type { InstalledPlugin } from "./installed-plugins";
import { lockDown } from "./plugin-lockdown";
import { PLUGIN_SCHEME, servePluginUi } from "./plugin-scheme";

export interface PluginViews {
  /** Creates, shows, hides and destroys views until they match `snapshot`. */
  follow(snapshot: HubChromeSnapshot): void;
  /** Lays every view out beside the Plugin Switcher, at the window's current size. */
  layout(): void;
  /** Destroys every view, as the Hub quits; resolves once each page has run its pagehide. */
  closeAll(): Promise<void>;
}

export function createPluginViews(
  window: BaseWindow,
  diagnostics: Diagnostics,
  installed: readonly InstalledPlugin[],
  displayLanguage: DisplayLanguage,
  /** Called when a Plugin UI fails to load: the whole Plugin closes. */
  closePlugin: (id: string) => void,
): PluginViews {
  const views = new Map<string, WebContentsView>();

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

  const open = ({ folder, manifest }: InstalledPlugin): WebContentsView => {
    const { id } = manifest;
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
        additionalArguments: [`${DISPLAY_LANGUAGE_ARG}${displayLanguage}`],
      },
    });
    lockDown(view, window, id);
    const pluginSession = diagnostics.startPluginSession({
      id: parsePluginId(id),
      version: parsePluginVersion(manifest.version),
    });
    view.webContents.on("console-message", ({ level, message }) => {
      pluginSession.recordConsoleMessage(level, message);
    });
    // A Plugin's beforeunload never holds a close (ADR 0009): Busy is how it asks to stay open.
    view.webContents.on("will-prevent-unload", (event) => {
      event.preventDefault();
    });
    // After the page's pagehide and its console messages.
    view.webContents.once("destroyed", () => {
      pluginSession.end();
    });
    view.setBounds(contentArea());
    window.contentView.addChildView(view);
    view.webContents
      .loadURL(`${PLUGIN_SCHEME}://${id}/index.html`)
      .catch((error: unknown) => {
        // A close cuts the load short: that is not a failure. Anything else closes the Plugin, if
        // this open is still the open one; its crash record arrives with #53.
        const cutShort =
          error instanceof Error &&
          "code" in error &&
          error.code === "ERR_ABORTED";
        if (!cutShort && views.get(id) === view) closePlugin(id);
      });
    return view;
  };

  const close = (id: string, view: WebContentsView): Promise<void> => {
    const destroyed = new Promise<void>((resolve) => {
      view.webContents.once("destroyed", () => {
        resolve();
      });
    });
    views.delete(id);
    window.contentView.removeChildView(view);
    // Destroys the page; removing the view alone would leak its webContents. On Electron 44 a plain
    // close() destroys it without running pagehide, so the unload handlers are run, and the
    // will-prevent-unload handler above stops any beforeunload from cancelling (probed by hand: a
    // cancelling page still closes in under 100 ms; the smoke suite asserts pagehide).
    view.webContents.close({ waitForBeforeUnload: true });
    return destroyed;
  };

  return {
    follow({ open: openIds, foreground }) {
      for (const [id, view] of views) {
        if (!openIds.includes(id)) void close(id, view);
      }
      for (const id of openIds) {
        const plugin = installed.find(({ manifest }) => manifest.id === id);
        if (plugin === undefined)
          throw new Error(`${id} is open but not installed`);
        const view = views.get(id) ?? open(plugin);
        views.set(id, view);
        // A hidden view stays alive; Chromium throttles it and the page sees visibilitychange.
        view.setVisible(id === foreground);
      }
    },
    layout() {
      for (const view of views.values()) view.setBounds(contentArea());
    },
    async closeAll() {
      await Promise.all([...views].map(([id, view]) => close(id, view)));
    },
  };
}
