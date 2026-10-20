// The Plugin lifecycle's state, held in the main process (spec #44 story 49) and drawn by the Hub
// Chrome from snapshots: the installed Plugins with their icons, which are open and which is in
// front, which cannot be opened and why, which are closing, and the Hub Chrome dialog waiting
// for staff. It also keeps each open Plugin's Busy reason, which only the dialogs show.

import type {
  DisplayText,
  Manifest,
  PluginId,
} from "@hawkeye-hub/plugin-format";
import semver from "semver";
import type {
  BusyPlugin,
  DialogAnswer,
  DisplayLanguage,
  HubChromeDialog,
  HubChromeSnapshot,
  PluginAccess,
} from "../shared/hub-chrome-ipc";
import { HUB_API_VERSION } from "./hub-api-version";
import type { HubApiVersion } from "./ids";
import type { InstalledPlugin } from "./installed-plugins";
import { pluginIconUrl } from "./plugin-icons";

export interface Lifecycle {
  snapshot(): HubChromeSnapshot;
  /** `listener` runs after every change to the state, to push a new snapshot. */
  onChange(listener: () => void): void;
  /**
   * Opens an installed Plugin, or brings it forward if it is open. Throws if it is not installed
   * or is blocked.
   */
  open(id: PluginId): void;
  /**
   * Starts closing an open Plugin, without asking: it is `closing`, and cannot be reopened, until
   * `closed`. Its Busy is cleared, and it leaves any dialog about it (spec #44 "Busy"): a dialog
   * about it alone goes away. Throws if it is not open.
   */
  close(id: PluginId): void;
  /**
   * Finishes closing a Plugin, once its Plugin UI is gone and its Backend, if any, has exited.
   * Throws if it is not closing.
   */
  closed(id: PluginId): void;
  /** A staff close: `close`, or, if the Plugin is Busy, the dialog asking first. */
  requestClose(id: PluginId): void;
  /**
   * Sets an open Plugin's Busy reason, or clears it with null. Ignored once the Plugin is not
   * open: its page can still say so as it closes. A dialog already up keeps the reasons it was
   * asked with (spec #44: "If Busy clears while it is up, the dialog stays"), so the snapshot does
   * not change and nothing is announced.
   */
  setBusy(id: PluginId, reason: string | null): void;
  /**
   * A normal quit (spec #44 "Quitting"): calls `quit`, or, if any Plugin is Busy, shows the one
   * dialog listing them all and calls `quit` on **Quit anyway**.
   */
  requestQuit(quit: () => void): void;
  /** Answers the pending dialog. Throws if there is none or the answer is not one of its buttons. */
  answer(answer: DialogAnswer): void;
}

/** Display text in `language`, falling back to English (ADR 0007). */
export function displayTextIn(
  text: DisplayText,
  language: DisplayLanguage,
): string {
  if (typeof text === "string") return text;
  return language === "zh-HK" && text["zh-HK"] !== undefined
    ? text["zh-HK"]
    : text["en-HK"];
}

/**
 * The gates (ADRs 0002, 0005), run when the list is built and again at `open`, which refuses
 * what they block.
 * Supported Platforms is checked at install, not here. There is no Auth Provider yet, so every
 * Plugin that requires a Staff Identity is blocked.
 */
export function accessOf(
  manifest: Manifest,
  hubApiVersion: HubApiVersion,
): PluginAccess {
  if (manifest.identity.kind === "required") {
    return { kind: "blocked", reason: "needs-sign-in" };
  }
  if (!semver.satisfies(hubApiVersion, manifest.hubApi)) {
    return { kind: "blocked", reason: "needs-different-hub" };
  }
  return { kind: "openable" };
}

// The dialog waiting for staff, as the lifecycle holds it: the quit dialog keeps the quit that
// **Quit anyway** goes ahead with.
type Asking =
  | Extract<HubChromeDialog, { kind: "busy-close" }>
  | (Extract<HubChromeDialog, { kind: "busy-quit" }> & { quit: () => void });

function dialogOf(asking: Asking | null): HubChromeDialog | null {
  if (asking === null) return null;
  switch (asking.kind) {
    case "busy-close":
      return asking;
    case "busy-quit":
      return { kind: "busy-quit", plugins: asking.plugins };
    default:
      return asking satisfies never;
  }
}

export function createLifecycle(
  displayLanguage: DisplayLanguage,
  installed: readonly InstalledPlugin[],
): Lifecycle {
  const byName = new Intl.Collator(displayLanguage).compare;
  const plugins = installed
    .map(({ manifest }) => ({
      manifest,
      listed: {
        id: manifest.id,
        name: displayTextIn(manifest.name, displayLanguage),
        iconUrl: pluginIconUrl(manifest.id),
        access: accessOf(manifest, HUB_API_VERSION),
      },
    }))
    .sort((a, b) => byName(a.listed.name, b.listed.name));
  const listed = plugins.map((plugin) => plugin.listed);
  const installedPlugin = (id: PluginId) => {
    const plugin = plugins.find(({ manifest }) => manifest.id === id);
    if (plugin === undefined) {
      throw new Error(`No installed Plugin has the id ${JSON.stringify(id)}`);
    }
    return plugin;
  };
  // The open Plugins, most recently foregrounded first: the first is in front, and closing it
  // brings forward the next.
  let open: PluginId[] = [];
  // Closed by staff or the Hub, but not yet gone: two Backends never share one Plugin Data
  // folder (ADR 0008), so a closing Plugin cannot be reopened.
  let closing: PluginId[] = [];
  let asking: Asking | null = null;
  // The latest Busy reason of each open Plugin that is Busy.
  const busy = new Map<PluginId, string>();
  const listeners: (() => void)[] = [];
  const changed = (): void => {
    for (const listener of listeners) listener();
  };
  const busyPlugin = (id: PluginId, reason: string): BusyPlugin => ({
    id,
    name: installedPlugin(id).listed.name,
    reason,
  });
  // The dialog without Plugin `id`, which has closed: none, once it was the only one asked about.
  const askingWithout = (id: PluginId): Asking | null => {
    if (asking === null) return null;
    switch (asking.kind) {
      case "busy-close":
        return asking.plugin.id === id ? null : asking;
      case "busy-quit": {
        const plugins = asking.plugins.filter((plugin) => plugin.id !== id);
        return plugins.length === 0 ? null : { ...asking, plugins };
      }
      default:
        return asking satisfies never;
    }
  };
  const close = (id: PluginId): void => {
    if (!open.includes(id)) {
      throw new Error(`No open Plugin has the id ${JSON.stringify(id)}`);
    }
    open = open.filter((other) => other !== id);
    closing = [...closing, id];
    busy.delete(id);
    asking = askingWithout(id);
    changed();
  };
  return {
    snapshot: () => ({
      displayLanguage,
      plugins: listed,
      open: [...open],
      closing: [...closing],
      foreground: open[0] ?? null,
      dialog: dialogOf(asking),
    }),
    onChange: (listener) => {
      listeners.push(listener);
    },
    open: (id) => {
      // The gates run again at open, not only when the list was built (spec #44).
      const access = accessOf(installedPlugin(id).manifest, HUB_API_VERSION);
      if (access.kind === "blocked") {
        throw new Error(
          `The Plugin ${JSON.stringify(id)} cannot be opened: ${access.reason}`,
        );
      }
      if (closing.includes(id)) {
        throw new Error(`${id} is still closing`);
      }
      open = [id, ...open.filter((other) => other !== id)];
      changed();
    },
    close,
    closed: (id) => {
      if (!closing.includes(id)) {
        throw new Error(`No closing Plugin has the id ${JSON.stringify(id)}`);
      }
      closing = closing.filter((other) => other !== id);
      changed();
    },
    requestClose: (id) => {
      const reason = busy.get(id);
      if (reason === undefined) {
        close(id);
        return;
      }
      asking = { kind: "busy-close", plugin: busyPlugin(id, reason) };
      changed();
    },
    setBusy: (id, reason) => {
      if (!open.includes(id)) return;
      if (reason === null) busy.delete(id);
      else busy.set(id, reason);
    },
    requestQuit: (quit) => {
      // In the Plugin Switcher's order.
      const busyPlugins = listed.flatMap(({ id }) => {
        const reason = busy.get(id);
        return reason === undefined ? [] : [busyPlugin(id, reason)];
      });
      if (busyPlugins.length === 0) {
        quit();
        return;
      }
      asking = { kind: "busy-quit", plugins: busyPlugins, quit };
      changed();
    },
    answer: (answer) => {
      const pending = asking;
      if (pending === null)
        throw new Error("No dialog is waiting for an answer");
      if (answer === "keep-open") {
        asking = null;
        changed();
        return;
      }
      if (pending.kind === "busy-close" && answer === "close-anyway") {
        close(pending.plugin.id);
        return;
      }
      if (pending.kind === "busy-quit" && answer === "quit-anyway") {
        asking = null;
        changed();
        pending.quit();
        return;
      }
      throw new Error(`${answer} does not answer a ${pending.kind} dialog`);
    },
  };
}
