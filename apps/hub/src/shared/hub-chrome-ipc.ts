// The Hub Chrome's IPC contract, shared by the main process, the Hub Chrome preload and the Hub
// Chrome. All lifecycle state lives in main (spec #44); the Hub Chrome only draws the latest
// snapshot, so a reloaded Hub Chrome redraws the same state by fetching it again.
// Types and constants only: the preload is sandboxed and the Hub Chrome has no Node.

import type { PluginId, PluginVersion } from "@hawkeye-hub/plugin-format";
import type { AiContent, AiFailure, AiModelChoice, SentPart } from "./ai-call";
import type { Branded } from "./branded";
import type {
  AiProvider,
  AiProviderLabel,
  ModelId,
  AiProviderRow,
  HubSettings,
  HubSettingsForm,
} from "./hub-settings";

export type { AiProviderRow, HubSettings, HubSettingsForm };

/** The languages the Hub draws in (ADR 0007): adding one is a Hub release. */
export const DISPLAY_LANGUAGES = ["en-HK", "zh-HK"] as const;
export type DisplayLanguage = (typeof DISPLAY_LANGUAGES)[number];

/** The Plugin Switcher's width: the Hub Chrome draws it, main lays Plugin UIs out beside it. */
export const SWITCHER_WIDTH_PX = 260;

/** The header strip's height: the Hub Chrome draws it, main lays Plugin UIs out below it. */
export const HEADER_STRIP_HEIGHT_PX = 40;

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

/** An icon on main's `hawkeye-icon` scheme, which only main's `plugin-icons` makes. */
export type IconUrl = Branded<string, "IconUrl">;

export interface SwitcherPlugin {
  id: PluginId;
  /** Already in the Display Language. */
  name: string;
  /** The Plugin's `icon.svg`, served to the Hub Chrome only as a CSS mask (spec #44 story 53). */
  iconUrl: IconUrl;
  access: PluginAccess;
  /** Starred by staff (CONTEXT.md "Favourite"): the Switcher shows it in its own section. */
  favourite: boolean;
}

/** Why an install failed (spec #91): `environment` is a Python Backend's venv that would not build. */
export type InstallFailureCause =
  "download" | "checksum" | "unpack" | "environment";

/** Whether a Plugin the Catalogue lists is installed, and at which version. */
export type CatalogueInstalled =
  { kind: "not-installed" } | { kind: "installed"; version: PluginVersion };

/**
 * The job queued or running for a Plugin the Catalogue lists, or how its last install failed, which
 * shows until staff try again. Update adds its own. `uninstalling` starts once staff confirm, while
 * an open Plugin is still closing.
 */
export type CatalogueJob =
  | { kind: "none" }
  | { kind: "installing" }
  | { kind: "install-failed"; cause: InstallFailureCause }
  | { kind: "uninstalling" };

/** A Plugin the Registry offers, at the version the Catalogue would install. */
export interface CataloguePlugin {
  id: PluginId;
  /** Already in the Display Language, as is the description. */
  name: string;
  description: string;
  /** The Registry's icon, served through the icon scheme as the Switcher's are. */
  iconUrl: IconUrl;
  /** The version Install would install: the newest installable, else the newest offered. */
  version: PluginVersion;
  access: CatalogueAccess;
  installed: CatalogueInstalled;
  job: CatalogueJob;
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
 * What a model accepts besides text, which every model takes (spec #142): `document` is a PDF,
 * `audio` a WAV or MP3. No video until a provider kind sends it.
 */
export const MODEL_INPUTS = ["image", "document", "audio"] as const;
export type ModelInput = (typeof MODEL_INPUTS)[number];

/** The inputs a provider of `kind` can send: the Anthropic library sends no audio. */
export function inputsFor(
  kind: "openai-compatible" | "anthropic",
): readonly ModelInput[] {
  switch (kind) {
    case "openai-compatible":
      return MODEL_INPUTS;
    case "anthropic":
      return ["image", "document"];
    default:
      return kind satisfies never;
  }
}

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
      form: HubSettingsForm;
      /** The rows whose provider has a key, stored or typed: a key itself never leaves main. */
      keysSet: AiProviderRow[];
      /** Whether the form parses as Hub Settings: Save refuses it until it does. */
      savable: boolean;
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
  /** The front Plugin's Assistant Panel. */
  assistant: AssistantPanel;
}

/** The Assistant Panel's width: the Hub Chrome draws it, main narrows the Plugin UI beside it. */
export const ASSISTANT_PANEL_WIDTH_PX = 400;

/**
 * The front Plugin's Assistant Panel: `none` when no Plugin is in front or it has no Assistant.
 * Open or closed is remembered per Plugin while the Hub runs.
 */
export type AssistantPanel =
  | { kind: "none" }
  | { kind: "closed" }
  | {
      kind: "open";
      conversation: Conversation;
      /** The Manifest's Prompt Templates, already in the Display Language. */
      templates: PromptTemplate[];
      model: CurrentModel;
      /** The saved AI Providers' labels and models, for the model picker. */
      providers: Pick<AiProvider, "label" | "models">[];
    };

export interface PromptTemplate {
  label: string;
  text: string;
}

/**
 * The Plugin's model: its picker's `choice`, and where its messages go. `none` is Default with no
 * Default AI Provider; `missing` is a chosen provider or model since removed, whose messages fail
 * with `provider-missing` (no silent switch). The composer offers only the `inputs` it accepts.
 */
export type CurrentModel = { choice: AiModelChoice } & (
  | { kind: "none" }
  | { kind: "missing" }
  | {
      kind: "chosen";
      provider: AiProviderLabel;
      model: ModelId;
      inputs: ModelInput[];
    }
);

/**
 * An open Plugin's one conversation with its Assistant, held in main and dropped when the Plugin
 * closes (ADR 0008: nothing about chats is saved).
 */
export interface Conversation {
  /** Every message sent and every finished (or stopped) reply, oldest first. */
  messages: ConversationMessage[];
  reply: AssistantReply;
}

/** A message staff sent, with its attachments' names, or a reply, which is text only. */
export type ConversationMessage =
  | { role: "user"; parts: SentPart[] }
  | { role: "assistant"; content: AiContent };

/**
 * The reply under way: none, streaming with what has arrived, or failed. A failure shows until
 * the next message.
 */
export type AssistantReply =
  | { kind: "idle" }
  | { kind: "streaming"; text: string }
  | { kind: "failed"; failure: AiFailure };

/** A Plugin's own Busy reason, in the Display Language. Never empty: main parses it so. */
export type BusyReason = Branded<string, "BusyReason">;

/** A Busy Plugin, by its name in the Display Language and its own reason. */
export interface BusyPlugin {
  id: PluginId;
  name: string;
  reason: BusyReason;
}

/**
 * Why a Plugin closed abnormally, in the words of its crash message (ADR 0012). Each cause has its
 * words in the Hub Chrome's strings.
 */
export type CrashCause = "crashed" | "failed-to-start" | "stopped-responding";

/** A Plugin that closed abnormally, by its name in the Display Language. */
export interface CrashedPlugin {
  id: PluginId;
  name: string;
}

/**
 * A Hub Chrome dialog. Its Busy reasons are those at the time it was asked: a Plugin clearing or
 * changing Busy leaves the dialog as it is (spec #44). A Plugin that closes leaves it.
 * `discard-changes` asks before picking a Plugin or quitting drops unsaved Hub Settings edits.
 * `uninstall` confirms an uninstall, with its "Also delete my data" checkbox.
 * `plugin-crashed` is a crash message: its **Export diagnostics** leaves it up, and **OK**
 * dismisses it.
 */
export type HubChromeDialog =
  | { kind: "busy-close"; plugin: BusyPlugin }
  | { kind: "busy-quit"; plugins: BusyPlugin[] }
  | { kind: "discard-changes" }
  | { kind: "uninstall"; plugin: { id: PluginId; name: string } }
  | { kind: "plugin-crashed"; plugin: CrashedPlugin; cause: CrashCause };

/**
 * Staff's answers to the pending dialog: **Keep open**, or **Close anyway** / **Quit anyway**, to
 * a Busy dialog; **Keep editing** or **Discard** to the Discard dialog; **Keep installed**, or
 * **Uninstall** with the checkbox unticked or ticked, to the uninstall dialog; **OK** to a crash
 * message.
 */
export const DIALOG_ANSWERS = [
  "keep-open",
  "close-anyway",
  "quit-anyway",
  "keep-editing",
  "discard",
  "keep-installed",
  "uninstall",
  "uninstall-and-delete-data",
  "ok",
] as const;
export type DialogAnswer = (typeof DIALOG_ANSWERS)[number];

/** Each dialog's first button, which keeps things as they are: Enter and Esc pick it too. */
export const KEEP_ANSWERS = {
  "busy-close": "keep-open",
  "busy-quit": "keep-open",
  "discard-changes": "keep-editing",
  uninstall: "keep-installed",
  "plugin-crashed": "ok",
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
  editSettings(form: HubSettingsForm): void;
  /** Types a new key for the provider in `row`, replacing its key on Save. */
  typeAiKey(row: AiProviderRow, key: string): void;
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
  /** Installs a Plugin the Catalogue lists as installable and not installed. */
  install(id: PluginId): void;
  /** Asks to uninstall an installed Plugin, through the uninstall dialog. */
  uninstall(id: PluginId): void;
  /** Opens or closes an open Plugin's Assistant Panel. */
  toggleAssistant(id: PluginId): void;
  /** Sends a message to an open Plugin's Assistant, which then streams its reply. */
  sendToAssistant(id: PluginId, parts: SentPart[]): void;
  /** Stops the reply streaming, keeping what has arrived. */
  stopAssistant(id: PluginId): void;
  /** Drops the conversation, stopping any reply, and starts again. */
  newConversation(id: PluginId): void;
  /** Sets an open Plugin's Assistant model, saved at once. */
  chooseModel(id: PluginId, model: AiModelChoice): void;
  /** Stars or unstars an installed Plugin as a Favourite, saved at once. */
  toggleFavourite(id: PluginId): void;
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
/** Hub Chrome → main, `invoke`: a provider's row and the key typed for it. */
export const TYPE_AI_KEY = "hub-chrome:type-ai-key";
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
/** Hub Chrome → main, `invoke`: the id of a Plugin to install from the Catalogue. */
export const INSTALL_PLUGIN = "hub-chrome:install-plugin";
/** Hub Chrome → main, `invoke`: the id of a Plugin to uninstall from the Catalogue. */
export const UNINSTALL_PLUGIN = "hub-chrome:uninstall-plugin";
/** Hub Chrome → main, `invoke`: the id of an open Plugin whose Assistant Panel to toggle. */
export const TOGGLE_ASSISTANT = "hub-chrome:toggle-assistant";
/** Hub Chrome → main, `invoke`: an open Plugin's id and the `SentPart`s to send its Assistant. */
export const SEND_TO_ASSISTANT = "hub-chrome:send-to-assistant";
/** Hub Chrome → main, `invoke`: the id of an open Plugin whose Assistant reply to stop. */
export const STOP_ASSISTANT = "hub-chrome:stop-assistant";
/** Hub Chrome → main, `invoke`: the id of an open Plugin whose conversation to start again. */
export const NEW_CONVERSATION = "hub-chrome:new-conversation";
/** Hub Chrome → main, `invoke`: an open Plugin's id and the `AiModelChoice` its Assistant uses. */
export const CHOOSE_MODEL = "hub-chrome:choose-model";
/** Hub Chrome → main, `invoke`: the id of an installed Plugin to star or unstar. */
export const TOGGLE_FAVOURITE = "hub-chrome:toggle-favourite";
