// The Plugin lifecycle's state, held in the main process (spec #44 story 49) and drawn by the Hub
// Chrome from snapshots: the installed Plugins with their icons, which are open and which is in
// front, and which are closing. Blocked reasons and the pending dialog join it in later tickets.

import type { DisplayText } from "@hawkeye-hub/plugin-format";
import type {
  DisplayLanguage,
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
   * Starts closing an open Plugin: it is `closing`, and cannot be reopened, until `closed`.
   * Throws if it is not open.
   */
  close(id: string): void;
  /**
   * Finishes closing a Plugin, once its Plugin UI is gone and its Backend, if any, has exited.
   * Throws if it is not closing.
   */
  closed(id: string): void;
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
  const listeners: (() => void)[] = [];
  const changed = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => ({
      displayLanguage,
      plugins,
      open: [...open],
      closing: [...closing],
      foreground: open[0] ?? null,
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
    close: (id) => {
      if (!open.includes(id)) {
        throw new Error(`No open Plugin has the id ${JSON.stringify(id)}`);
      }
      open = open.filter((other) => other !== id);
      closing = [...closing, id];
      changed();
    },
    closed: (id) => {
      if (!closing.includes(id)) {
        throw new Error(`No closing Plugin has the id ${JSON.stringify(id)}`);
      }
      closing = closing.filter((other) => other !== id);
      changed();
    },
  };
}
