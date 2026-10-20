// The Plugin lifecycle's state, held in the main process (spec #44 story 49) and drawn by the Hub
// Chrome from snapshots: the installed Plugins with their icons, which are open and which is in
// front, which cannot be opened and why, which are closing, and the Hub Chrome dialog waiting
// for staff. It also keeps each open Plugin's Busy reason, which only the dialogs show.

import type {
  DisplayText,
  Manifest,
  PluginId,
} from "@hawkeye-hub/plugin-format";
import { isDeepStrictEqual } from "node:util";
import semver from "semver";
import type {
  BusyPlugin,
  BusyReason,
  DialogAnswer,
  DisplayLanguage,
  HubChromeContent,
  HubChromeDialog,
  HubChromeSnapshot,
  HubSettings,
  HubVersion,
  PluginAccess,
  ThemeName,
} from "../shared/hub-chrome-ipc";
import { HUB_API_VERSION } from "./hub-api-version";
import type { HubApiVersion } from "./ids";
import type { InstalledPlugin } from "./installed-plugins";
import { pluginIconUrl } from "./plugin-icons";

/** An open Plugin's Busy, as its page last set it. */
export type Busy = { kind: "busy"; reason: BusyReason } | { kind: "not-busy" };

export interface Lifecycle {
  snapshot(): HubChromeSnapshot;
  /** The installed Plugin with `id`. Throws if none is. */
  installed(id: PluginId): InstalledPlugin;
  /** `listener` runs after every change to the state, to push a new snapshot. */
  onChange(listener: () => void): void;
  /**
   * Opens an installed Plugin, or brings it forward if it is open, leaving Hub Settings if they
   * are showing. Throws if it is not installed or is blocked.
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
   * Sets or clears an open Plugin's Busy. Ignored once the Plugin is not
   * open: its page can still say so as it closes. A dialog already up keeps the reasons it was
   * asked with (spec #44: "If Busy clears while it is up, the dialog stays"), so the snapshot does
   * not change and nothing is announced.
   */
  setBusy(id: PluginId, busy: Busy): void;
  /**
   * A normal quit (spec #44 "Quitting"): calls `quit`, or, if any Plugin is Busy, shows the one
   * dialog listing them all and calls `quit` on **Quit anyway**.
   */
  requestQuit(quit: () => void): void;
  /** Answers the pending dialog. Throws if there is none or the answer is not one of its buttons. */
  answer(answer: DialogAnswer): void;
  /** Shows Hub Settings in the content area, until `open` brings a Plugin forward. */
  showSettings(): void;
  /** Replaces the unsaved form. Throws if settings are not showing. */
  editSettings(form: HubSettings): void;
  /**
   * Saves the form through the save callback and makes it what is stored. Does nothing when the
   * form is what is stored. Throws if settings are not showing.
   */
  saveSettings(): void;
  /** Puts the form back to what is stored. Throws if settings are not showing. */
  cancelSettings(): void;
  /** The Hub Settings as last saved, whatever the form holds. */
  storedSettings(): HubSettings;
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

// The `as` grants the brand to a literal that is kebab-case, as ThemeName requires.
const HAWKEYE = "hawkeye" as ThemeName;
/** The Themes built into the Hub (ADR 0006): adding one is a Hub release. */
export const THEMES: readonly ThemeName[] = [HAWKEYE];
// ponytail: Hawkeye until the Company Configuration is fetched; the Registry work routes the
// fetched default Theme in here (spec #71).
const COMPANY_THEME = HAWKEYE;

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
  hubVersion: HubVersion,
  displayLanguage: DisplayLanguage,
  installed: readonly InstalledPlugin[],
  storedAtStart: HubSettings,
  /** Writes saved Hub Settings and applies them; called only when they changed. */
  save: (settings: HubSettings) => void,
  /** Logs a stored or company Theme this Hub does not have; called once per name. */
  unknownTheme: (name: ThemeName) => void,
): Lifecycle {
  const byName = new Intl.Collator(displayLanguage).compare;
  const plugins = installed
    .map((plugin) => ({
      plugin,
      listed: {
        id: plugin.manifest.id,
        name: displayTextIn(plugin.manifest.name, displayLanguage),
        iconUrl: pluginIconUrl(plugin.manifest.id),
        access: accessOf(plugin.manifest, HUB_API_VERSION),
      },
    }))
    .sort((a, b) => byName(a.listed.name, b.listed.name));
  const listed = plugins.map((plugin) => plugin.listed);
  const installedPlugin = (id: PluginId) => {
    const plugin = plugins.find(({ listed }) => listed.id === id);
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
  // Plugins closing behind Hub Settings leave them showing.
  let content: HubChromeContent["kind"] = "plugin";
  let stored = storedAtStart;
  // The unsaved form: what is stored until staff edit it.
  let form = storedAtStart;
  // The stored Theme resolved: a name this Hub has no Theme for draws in Hawkeye, and is kept.
  const reported = new Set<ThemeName>();
  const resolveTheme = (setting: HubSettings["theme"]): ThemeName => {
    const name = setting.kind === "company" ? COMPANY_THEME : setting.name;
    if (THEMES.includes(name)) return name;
    if (!reported.has(name)) {
      reported.add(name);
      unknownTheme(name);
    }
    return HAWKEYE;
  };
  let theme = resolveTheme(stored.theme);
  const settingsShowing = (operation: string): void => {
    if (content !== "settings") {
      throw new Error(`${operation} needs Hub Settings showing`);
    }
  };
  // The latest Busy reason of each open Plugin that is Busy.
  const busyReasons = new Map<PluginId, BusyReason>();
  const listeners: (() => void)[] = [];
  const changed = (): void => {
    for (const listener of listeners) listener();
  };
  const busyPlugin = (id: PluginId, reason: BusyReason): BusyPlugin => ({
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
    busyReasons.delete(id);
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
      content:
        content === "settings"
          ? { kind: "settings", stored, form }
          : { kind: "plugin" },
      dialog: dialogOf(asking),
      hubVersion,
      theme,
      themes: [...THEMES],
    }),
    installed: (id) => installedPlugin(id).plugin,
    onChange: (listener) => {
      listeners.push(listener);
    },
    open: (id) => {
      // The gates run again at open, not only when the list was built (spec #44).
      const access = accessOf(
        installedPlugin(id).plugin.manifest,
        HUB_API_VERSION,
      );
      if (access.kind === "blocked") {
        throw new Error(
          `The Plugin ${JSON.stringify(id)} cannot be opened: ${access.reason}`,
        );
      }
      if (closing.includes(id)) {
        throw new Error(`${id} is still closing`);
      }
      open = [id, ...open.filter((other) => other !== id)];
      content = "plugin";
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
      const reason = busyReasons.get(id);
      if (reason === undefined) {
        close(id);
        return;
      }
      asking = { kind: "busy-close", plugin: busyPlugin(id, reason) };
      changed();
    },
    setBusy: (id, busy) => {
      if (!open.includes(id)) return;
      switch (busy.kind) {
        case "busy":
          busyReasons.set(id, busy.reason);
          return;
        case "not-busy":
          busyReasons.delete(id);
          return;
        default:
          return busy satisfies never;
      }
    },
    requestQuit: (quit) => {
      // In the Plugin Switcher's order.
      const busyPlugins = listed.flatMap(({ id }) => {
        const reason = busyReasons.get(id);
        return reason === undefined ? [] : [busyPlugin(id, reason)];
      });
      if (busyPlugins.length === 0) {
        quit();
        return;
      }
      asking = { kind: "busy-quit", plugins: busyPlugins, quit };
      changed();
    },
    showSettings: () => {
      content = "settings";
      changed();
    },
    editSettings: (edited) => {
      settingsShowing("editSettings");
      form = edited;
      changed();
    },
    saveSettings: () => {
      settingsShowing("saveSettings");
      if (isDeepStrictEqual(form, stored)) return;
      save(form);
      stored = form;
      theme = resolveTheme(stored.theme);
      changed();
    },
    cancelSettings: () => {
      settingsShowing("cancelSettings");
      form = stored;
      changed();
    },
    storedSettings: () => stored,
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
