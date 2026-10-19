// The Plugin lifecycle's state, held in the main process (spec #44 story 49) and drawn by the Hub
// Chrome from snapshots: the installed Plugins with their icons, which are open and which is in
// front, which are closing, and the Hub Chrome dialog waiting for staff. It also keeps each open
// Plugin's Busy reason, which only the dialogs show. Blocked reasons join it in a later ticket.

import type { DisplayText } from "@hawkeye-hub/plugin-format";
import type {
  BusyPlugin,
  DialogAnswer,
  DisplayLanguage,
  HubChromeDialog,
  HubChromeSnapshot,
} from "../shared/hub-chrome-ipc";
import type { InstalledPlugin } from "./installed-plugins";
import { pluginIconUrl } from "./plugin-icons";

export interface Lifecycle {
  snapshot(): HubChromeSnapshot;
  /** `listener` runs after every change to the state, to push a new snapshot. */
  onChange(listener: () => void): void;
  /** Opens an installed Plugin, or brings it forward if it is open. Throws if it is not installed. */
  open(id: string): void;
  /**
   * Starts closing an open Plugin, without asking: it is `closing`, and cannot be reopened, until
   * `closed`. Its Busy is cleared, and a dialog about closing it goes away. Throws if it is not open.
   */
  close(id: string): void;
  /**
   * Finishes closing a Plugin, once its Plugin UI is gone and its Backend, if any, has exited.
   * Throws if it is not closing.
   */
  closed(id: string): void;
  /** A staff close: `close`, or, if the Plugin is Busy, the dialog asking first. */
  requestClose(id: string): void;
  /**
   * Sets an open Plugin's Busy reason, or clears it with null. Ignored once the Plugin is not
   * open: its page can still say so as it closes.
   */
  setBusy(id: string, reason: string | null): void;
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

export function createLifecycle(
  displayLanguage: DisplayLanguage,
  installed: readonly InstalledPlugin[],
): Lifecycle {
  const byName = new Intl.Collator(displayLanguage).compare;
  const plugins = installed
    .map(({ manifest }) => ({
      id: manifest.id,
      name: displayTextIn(manifest.name, displayLanguage),
      iconUrl: pluginIconUrl(manifest.id),
      access: { kind: "openable" } as const,
    }))
    .sort((a, b) => byName(a.name, b.name));
  // The open Plugins, most recently foregrounded first: the first is in front, and closing it
  // brings forward the next.
  let open: string[] = [];
  // Closed by staff or the Hub, but not yet gone: two Backends never share one Plugin Data
  // folder (ADR 0008), so a closing Plugin cannot be reopened.
  let closing: string[] = [];
  let dialog: HubChromeDialog | null = null;
  // The latest Busy reason of each open Plugin that is Busy.
  const busy = new Map<string, string>();
  // What **Quit anyway** does while the Busy quit dialog is up. A no-op otherwise.
  let quitAnyway: () => void = () => undefined;
  const listeners: (() => void)[] = [];
  const changed = (): void => {
    for (const listener of listeners) listener();
  };
  const close = (id: string): void => {
    if (!open.includes(id)) {
      throw new Error(`No open Plugin has the id ${JSON.stringify(id)}`);
    }
    open = open.filter((other) => other !== id);
    closing = [...closing, id];
    busy.delete(id);
    if (dialog?.kind === "busy-close" && dialog.id === id) dialog = null;
    changed();
  };
  const busyPlugin = (id: string, reason: string): BusyPlugin => {
    const plugin = plugins.find((each) => each.id === id);
    if (plugin === undefined)
      throw new Error(`${id} is open but not installed`);
    return { name: plugin.name, reason };
  };
  return {
    snapshot: () => ({
      displayLanguage,
      plugins,
      open: [...open],
      closing: [...closing],
      foreground: open[0] ?? null,
      dialog,
    }),
    onChange: (listener) => {
      listeners.push(listener);
    },
    open: (id) => {
      if (!plugins.some((plugin) => plugin.id === id)) {
        throw new Error(`No installed Plugin has the id ${JSON.stringify(id)}`);
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
      dialog = { kind: "busy-close", id, plugin: busyPlugin(id, reason) };
      changed();
    },
    setBusy: (id, reason) => {
      if (!open.includes(id)) return;
      if (reason === null) busy.delete(id);
      else busy.set(id, reason);
    },
    requestQuit: (quit) => {
      // In the Plugin Switcher's order.
      const busyPlugins = plugins.flatMap(({ id }) => {
        const reason = busy.get(id);
        return reason === undefined ? [] : [busyPlugin(id, reason)];
      });
      if (busyPlugins.length === 0) {
        quit();
        return;
      }
      quitAnyway = quit;
      dialog = { kind: "busy-quit", plugins: busyPlugins };
      changed();
    },
    answer: (answer) => {
      const pending = dialog;
      if (pending === null)
        throw new Error("No dialog is waiting for an answer");
      if (answer === "keep-open") {
        dialog = null;
        changed();
        return;
      }
      if (pending.kind === "busy-close" && answer === "close-anyway") {
        close(pending.id);
        return;
      }
      if (pending.kind === "busy-quit" && answer === "quit-anyway") {
        dialog = null;
        changed();
        quitAnyway();
        return;
      }
      throw new Error(`${answer} does not answer a ${pending.kind} dialog`);
    },
  };
}
