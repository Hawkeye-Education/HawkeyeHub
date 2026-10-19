// The Hub Chrome's IPC contract, shared by the main process, the Hub Chrome preload and the Hub
// Chrome. All lifecycle state lives in main (spec #44); the Hub Chrome only draws the latest
// snapshot, so a reloaded Hub Chrome redraws the same state by fetching it again.
// Types and constants only: the preload is sandboxed and the Hub Chrome has no Node.

/** The languages the Hub draws in (ADR 0007): adding one is a Hub release. */
export type DisplayLanguage = "en-HK" | "zh-HK";

/** The Plugin Switcher's width: the Hub Chrome draws it, main lays Plugin UIs out beside it. */
export const SWITCHER_WIDTH_PX = 240;

/** Whether staff can open an installed Plugin. Later tickets add `blocked` with its reason. */
export interface PluginAccess {
  kind: "openable";
}

export interface SwitcherPlugin {
  id: string;
  /** Already in the Display Language. */
  name: string;
  /** The Plugin's `icon.svg`, served to the Hub Chrome only as a CSS mask (spec #44 story 53). */
  iconUrl: string;
  access: PluginAccess;
}

export interface HubChromeSnapshot {
  displayLanguage: DisplayLanguage;
  /** Every installed Plugin, sorted by name. */
  plugins: SwitcherPlugin[];
  /** The ids of the open Plugins, most recently foregrounded first. */
  open: string[];
  /** The ids of the Plugins closed but not yet gone, which cannot be reopened until they are. */
  closing: string[];
  /** The Plugin in front. Null when none is: the Hub Chrome then draws the empty state. */
  foreground: string | null;
  /** The Hub Chrome dialog waiting for an answer, drawn on the dialog overlay. Null when none is. */
  dialog: HubChromeDialog | null;
}

/** A Busy Plugin, by its name in the Display Language and its own reason. */
export interface BusyPlugin {
  name: string;
  reason: string;
}

/**
 * A Hub Chrome dialog. Its Busy reasons are those at the time it was asked: a Plugin clearing
 * Busy leaves the dialog as it is (spec #44).
 */
export type HubChromeDialog =
  | { kind: "busy-close"; id: string; plugin: BusyPlugin }
  | { kind: "busy-quit"; plugins: BusyPlugin[] };

/** Staff's answer to the pending dialog: **Keep open**, or **Close anyway** / **Quit anyway**. */
export type DialogAnswer = "keep-open" | "close-anyway" | "quit-anyway";

/** What the Hub Chrome preload exposes as `window.hubChrome`. */
export interface HubChromeApi {
  /**
   * Calls `listener` with the current snapshot, then with each new one main pushes. Main sends
   * the pushes and the fetch's answer down one ordered channel, so the latest call is current.
   */
  subscribe(listener: (snapshot: HubChromeSnapshot) => void): void;
  /** Opens a closed Plugin, or brings an open one forward. */
  open(id: string): void;
  /** Closes an open Plugin, asking first if it is Busy. */
  close(id: string): void;
  /** Answers the pending dialog. */
  answer(answer: DialogAnswer): void;
}

/** Hub Chrome → main, `invoke`: answers the current snapshot. */
export const GET_SNAPSHOT = "hub-chrome:get-snapshot";
/** Main → Hub Chrome, `send`: a new snapshot, on every change. */
export const SNAPSHOT_CHANGED = "hub-chrome:snapshot-changed";
/** Hub Chrome → main, `send`: the id of a Plugin to open or bring forward. */
export const OPEN_PLUGIN = "hub-chrome:open-plugin";
/** Hub Chrome → main, `send`: the id of an open Plugin to close. */
export const CLOSE_PLUGIN = "hub-chrome:close-plugin";
/** Hub Chrome → main, `invoke`: the `DialogAnswer` to the pending dialog. */
export const ANSWER_DIALOG = "hub-chrome:answer-dialog";
