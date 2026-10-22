// The Hub Chrome's IPC contract, shared by the main process, the Hub Chrome preload and the Hub
// Chrome. All lifecycle state lives in main (spec #44); the Hub Chrome only draws the latest
// snapshot, so a reloaded Hub Chrome redraws the same state by fetching it again.
// Types and constants only: the preload is sandboxed and the Hub Chrome has no Node.

import type { PluginId } from "@hawkeye-hub/plugin-format";
import type { Branded } from "./branded";
import type { HubSettings } from "./hub-settings";

export type { HubSettings };

/** The languages the Hub draws in (ADR 0007): adding one is a Hub release. */
export const DISPLAY_LANGUAGES = ["en-HK", "zh-HK"] as const;
export type DisplayLanguage = (typeof DISPLAY_LANGUAGES)[number];

/** The Plugin Switcher's width: the Hub Chrome draws it, main lays Plugin UIs out beside it. */
export const SWITCHER_WIDTH_PX = 240;

/**
 * Why the Hub cannot run an installed Plugin (ADRs 0002, 0005): it needs a Staff Identity and
 * there is no Auth Provider, or its `hubApi` range excludes this Hub's Hub API version.
 */
export type BlockedReason = "needs-sign-in" | "needs-different-hub";

/**
 * Why the Plugin Catalogue cannot install a Plugin: none of its Supported Platforms is this
 * computer, or a reason it could not be opened once installed.
 */
export type CatalogueBlockedReason = "not-for-this-computer" | BlockedReason;

/** Whether staff can install a Plugin the Registry offers, and if not, why. */
export type CatalogueAccess =
  { kind: "installable" } | { kind: "blocked"; reason: CatalogueBlockedReason };

/** Whether staff can open an installed Plugin, and if not, why. */
export type PluginAccess =
  { kind: "openable" } | { kind: "blocked"; reason: BlockedReason };

export interface SwitcherPlugin {
  id: PluginId;
  /** Already in the Display Language. */
  name: string;
  /** The Plugin's `icon.svg`, served to the Hub Chrome only as a CSS mask (spec #44 story 53). */
  iconUrl: string;
  access: PluginAccess;
}

/** A Plugin the Registry offers, at the version the Catalogue would install. */
export interface CataloguePlugin {
  id: PluginId;
  /** Already in the Display Language, as is the description. */
  name: string;
  description: string;
  /** The Registry's icon, served through the icon scheme as the Switcher's are. */
  iconUrl: string;
  access: CatalogueAccess;
}

/**
 * What the Plugin Catalogue lists: `off` in dev mode, which has no Catalogue; `checking` until a
 * Registry check answers; `unreachable` after one failed, until Retry.
 */
export type Catalogue =
  | { kind: "off" }
  | { kind: "checking" }
  | { kind: "unreachable" }
  | { kind: "listed"; plugins: CataloguePlugin[] };

/** The Hub's own version (semver), as main parses it. */
export type HubVersion = Branded<string, "HubVersion">;

/** A Theme's name, such as `hawkeye`: kebab-case, and not necessarily one this Hub has. */
export type ThemeName = Branded<string, "ThemeName">;

/** The Colour Schemes staff choose from (ADR 0006): `system` follows the OS. */
export const COLOUR_SCHEMES = ["system", "light", "dark"] as const;
export type ColourScheme = (typeof COLOUR_SCHEMES)[number];

/**
 * What the content area shows: the front Plugin's UI (or the empty state when none is open), or
 * Hub Settings or the Plugin Catalogue, with the open Plugins still running hidden behind them.
 * Settings carry the unsaved form, held in main, so a reloaded Hub Chrome redraws it.
 */
export type HubChromeContent =
  | { kind: "plugin" }
  | { kind: "catalogue" }
  | {
      kind: "settings";
      form: HubSettings;
      /**
       * A Save changed the Display Language while a Plugin was open: open Plugin UIs keep the one
       * they were opened with until reopened (ADR 0007). Cleared on leaving settings, or once no
       * Plugin is open.
       */
      languageNoteShowing: boolean;
    };

export interface HubChromeSnapshot {
  displayLanguage: DisplayLanguage;
  /** Every installed Plugin, sorted by name. */
  plugins: SwitcherPlugin[];
  /** The ids of the open Plugins, most recently foregrounded first. */
  open: PluginId[];
  /** The ids of the Plugins closed but not yet gone, which cannot be reopened until they are. */
  closing: PluginId[];
  /** The Plugin in front. Null when none is: the Hub Chrome then draws the empty state. */
  foreground: PluginId | null;
  content: HubChromeContent;
  /** The Hub Chrome dialog waiting for an answer, drawn on the dialog overlay. Null when none is. */
  dialog: HubChromeDialog | null;
  hubVersion: HubVersion;
  /** The Theme the Hub draws in: the stored one resolved, Hawkeye when this Hub lacks it. */
  theme: ThemeName;
  /** The Themes this Hub has, for the Theme picker. */
  themes: ThemeName[];
  catalogue: Catalogue;
}

/** A Plugin's own Busy reason, in the Display Language. Never empty: main parses it so. */
export type BusyReason = Branded<string, "BusyReason">;

/** A Busy Plugin, by its name in the Display Language and its own reason. */
export interface BusyPlugin {
  id: PluginId;
  name: string;
  reason: BusyReason;
}

/**
 * A Hub Chrome dialog. Its Busy reasons are those at the time it was asked: a Plugin clearing or
 * changing Busy leaves the dialog as it is (spec #44). A Plugin that closes leaves it.
 * `discard-changes` asks before picking a Plugin or quitting drops unsaved Hub Settings edits.
 */
export type HubChromeDialog =
  | { kind: "busy-close"; plugin: BusyPlugin }
  | { kind: "busy-quit"; plugins: BusyPlugin[] }
  | { kind: "discard-changes" };

/**
 * Staff's answers to the pending dialog: **Keep open**, or **Close anyway** / **Quit anyway**, to
 * a Busy dialog; **Keep editing** or **Discard** to the Discard dialog.
 */
export const DIALOG_ANSWERS = [
  "keep-open",
  "close-anyway",
  "quit-anyway",
  "keep-editing",
  "discard",
] as const;
export type DialogAnswer = (typeof DIALOG_ANSWERS)[number];

/** Each dialog's first button, which keeps things as they are: Enter and Esc pick it too. */
export const KEEP_ANSWERS = {
  "busy-close": "keep-open",
  "busy-quit": "keep-open",
  "discard-changes": "keep-editing",
} as const satisfies Record<HubChromeDialog["kind"], DialogAnswer>;

/** What the Hub Chrome preload exposes as `window.hubChrome`. */
export interface HubChromeApi {
  /**
   * Calls `listener` with the current snapshot, then with each new one main pushes. Main sends
   * the pushes and the fetch's answer down one ordered channel, so the latest call is current.
   */
  subscribe(listener: (snapshot: HubChromeSnapshot) => void): void;
  /** Opens a closed Plugin, or brings an open one forward. */
  open(id: PluginId): void;
  /** Closes an open Plugin, asking first if it is Busy. */
  close(id: PluginId): void;
  /** Answers the pending dialog. */
  answer(answer: DialogAnswer): void;
  /** Shows Hub Settings in the content area. */
  showSettings(): void;
  /** Replaces the unsaved Hub Settings form. */
  editSettings(form: HubSettings): void;
  /** Saves the form and applies it, unless it is what is stored. */
  saveSettings(): void;
  /** Puts the form back to what is stored. */
  cancelSettings(): void;
  /** Exports a Diagnostics Bundle to where staff choose in a native save dialog. */
  exportDiagnostics(): void;
  /** Shows the Plugin Catalogue in the content area. */
  showCatalogue(): void;
  /** Checks the Registry again after a failed check. */
  retryRegistry(): void;
}

/** Hub Chrome → main, `invoke`: answers the current snapshot. */
export const GET_SNAPSHOT = "hub-chrome:get-snapshot";
/** Main → Hub Chrome, `send`: a new snapshot, on every change. */
export const SNAPSHOT_CHANGED = "hub-chrome:snapshot-changed";
/** Hub Chrome → main, `invoke`: the id of a Plugin to open or bring forward. */
export const OPEN_PLUGIN = "hub-chrome:open-plugin";
/** Hub Chrome → main, `invoke`: the id of an open Plugin to close. */
export const CLOSE_PLUGIN = "hub-chrome:close-plugin";
/** Hub Chrome → main, `invoke`: the `DialogAnswer` to the pending dialog. */
export const ANSWER_DIALOG = "hub-chrome:answer-dialog";
/** Hub Chrome → main, `invoke`: shows Hub Settings. */
export const SHOW_SETTINGS = "hub-chrome:show-settings";
/** Hub Chrome → main, `invoke`: the `HubSettings` that replace the unsaved form. */
export const EDIT_SETTINGS = "hub-chrome:edit-settings";
/** Hub Chrome → main, `invoke`: saves the form. */
export const SAVE_SETTINGS = "hub-chrome:save-settings";
/** Hub Chrome → main, `invoke`: puts the form back to what is stored. */
export const CANCEL_SETTINGS = "hub-chrome:cancel-settings";
/** Hub Chrome → main, `invoke`: exports a Diagnostics Bundle through a native save dialog. */
export const EXPORT_DIAGNOSTICS = "hub-chrome:export-diagnostics";
/** Hub Chrome → main, `invoke`: shows the Plugin Catalogue. */
export const SHOW_CATALOGUE = "hub-chrome:show-catalogue";
/** Hub Chrome → main, `invoke`: checks the Registry again. */
export const RETRY_REGISTRY = "hub-chrome:retry-registry";
