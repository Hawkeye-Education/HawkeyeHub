// The Hub Chrome's IPC contract, shared by the main process, the Hub Chrome preload and the Hub
// Chrome. All lifecycle state lives in main (spec #44); the Hub Chrome only draws the latest
// snapshot, so a reloaded Hub Chrome redraws the same state by fetching it again.
// Types and constants only: the preload is sandboxed and the Hub Chrome has no Node.

/** The languages the Hub draws in (ADR 0007): adding one is a Hub release. */
export type DisplayLanguage = "en-HK" | "zh-HK";

/** Whether staff can open an installed Plugin. Later tickets add `blocked` with its reason. */
export interface PluginAccess {
  kind: "openable";
}

export interface SwitcherPlugin {
  id: string;
  /** Already in the Display Language. */
  name: string;
  access: PluginAccess;
}

export interface HubChromeSnapshot {
  displayLanguage: DisplayLanguage;
  /** Every installed Plugin, sorted by name. */
  plugins: SwitcherPlugin[];
}

/** What the Hub Chrome preload exposes as `window.hubChrome`. */
export interface HubChromeApi {
  /**
   * Calls `listener` with the current snapshot, then with each new one main pushes. Main sends
   * the pushes and the fetch's answer down one ordered channel, so the latest call is current.
   */
  subscribe(listener: (snapshot: HubChromeSnapshot) => void): void;
}

/** Hub Chrome → main, `invoke`: answers the current snapshot. */
export const GET_SNAPSHOT = "hub-chrome:get-snapshot";
/** Main → Hub Chrome, `send`: a new snapshot, on every change. */
export const SNAPSHOT_CHANGED = "hub-chrome:snapshot-changed";
