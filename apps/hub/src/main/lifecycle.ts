// The Plugin lifecycle's state, held in the main process (spec #44 story 49) and drawn by the Hub
// Chrome from snapshots. Holds only the installed Plugins so far; open Plugins, the foreground
// Plugin, blocked reasons and the pending dialog join it in later tickets.

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
  // Nothing changes the state yet; open and close (#48) will call these.
  const listeners: (() => void)[] = [];
  return {
    snapshot: () => ({ displayLanguage, plugins }),
    onChange: (listener) => {
      listeners.push(listener);
    },
  };
}
