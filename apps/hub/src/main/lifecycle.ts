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
import {
  KEEP_ANSWERS,
  type BusyPlugin,
  type BusyReason,
  type CurrentModel,
  type Catalogue,
  type CatalogueJob,
  type CrashCause,
  type DialogAnswer,
  type DisplayLanguage,
  type AssistantPanel,
  type Conversation,
  type HubChromeDialog,
  type HubChromeSnapshot,
  type HubSettings,
  type HubVersion,
  type PluginAccess,
  type ThemeName,
} from "../shared/hub-chrome-ipc";
import type {
  AiChatRequest,
  AiContent,
  AiModelChoice,
} from "../shared/ai-call";
import type { AiProviderRow, HubSettingsForm } from "../shared/hub-settings";
import { AiCallFailed, labelAndModels, targetOf, type AiChat } from "./ai";
import type { AssistantModels } from "./assistant-models";
import type { AiProviderKey, SavedProviderKey } from "./ai-keys";
import {
  describeAuthProvider,
  type CompanyConfiguration,
} from "./company-config";
import type { SystemDescription } from "./diagnostics";
import { HUB_API_VERSION } from "./hub-api-version";
import type { AiProviderLabel, HubApiVersion } from "./ids";
import { formOf, rowsWithKey, settingsFrom } from "./settings-form";
import { pluginRefOf, type InstalledPlugin } from "./installed-plugins";
import { pluginIconUrl, registryIconUrl } from "./plugin-icons";
import type { InstallOutcome } from "./plugin-install";
import type { UninstallData } from "./plugin-uninstall";
import type { RegistryCheck, RegistryPlugin } from "./registry";

/** An open Plugin's Busy, as its page last set it. */
export type Busy = { kind: "busy"; reason: BusyReason } | { kind: "not-busy" };

export interface Lifecycle {
  snapshot(): HubChromeSnapshot;
  /** The installed Plugin with `id`. Throws if none is. */
  installed(id: PluginId): InstalledPlugin;
  /** Whether the Plugin with `id` is open or closing. */
  running(id: PluginId): boolean;
  /** `listener` runs after every change to the state, to push a new snapshot. */
  onChange(listener: () => void): void;
  /**
   * Opens an installed Plugin, or brings it forward if it is open, leaving Hub Settings if they
   * are showing; with unsaved edits, the Discard dialog asks first and **Discard** opens it.
   * Throws if it is not installed or is blocked.
   */
  open(id: PluginId): void;
  /**
   * Starts closing an open Plugin, without asking: it is `closing`, and cannot be reopened, until
   * `closed`. Its Busy is cleared, and it leaves any dialog about it (spec #44 "Busy"): a dialog
   * about it alone goes away, and a quit dialog about it alone goes ahead with the quit. Throws if
   * it is not open.
   */
  close(id: PluginId): void;
  /**
   * A Plugin that closed abnormally: `close`, then its crash message, naming it in the Display
   * Language. Crash messages queue, one each, behind any other dialog. Throws if it is not open.
   */
  crashed(id: PluginId, cause: CrashCause): void;
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
   * dialog listing them all and calls `quit` on **Quit anyway**. With unsaved Hub Settings edits,
   * the Discard dialog asks before all that, and **Discard** goes on to it.
   */
  requestQuit(quit: () => void): void;
  /** Answers the pending dialog. Throws if there is none or the answer is not one of its buttons. */
  answer(answer: DialogAnswer): void;
  /** Shows Hub Settings in the content area, until `open` brings a Plugin forward. */
  showSettings(): void;
  /**
   * Shows the Plugin Catalogue in the content area, until `open` brings a Plugin forward; from
   * settings with unsaved edits, the Discard dialog asks first. Throws in dev mode.
   */
  showCatalogue(): void;
  /** Takes a Registry check's answer into the Catalogue. Throws in dev mode. */
  registryChecked(check: RegistryCheck): void;
  /** **Retry**: the Catalogue is checking, and the Registry is checked again. Throws unless unreachable. */
  retryRegistry(): void;
  /**
   * **Install**: the Catalogue entry is installing, and main is asked to install the version
   * offered, answering through `installFinished`. Throws unless the latest check offered the Plugin
   * as installable, and it is neither installed nor installing.
   */
  install(id: PluginId): void;
  /**
   * An install's answer: an installed Plugin joins the Plugin Switcher at once; a failure shows its
   * cause in the Catalogue until staff try again. Throws unless the Plugin is installing.
   */
  installFinished(id: PluginId, outcome: InstallOutcome): void;
  /**
   * **Uninstall**: an open Plugin is closed first, asking first if it is Busy (**Keep open** keeps
   * it open and installed, and asks nothing more). Then the uninstall dialog asks. Confirming it
   * makes the Catalogue entry uninstalling; once the Plugin is closed, main is asked to uninstall
   * it, answering through `uninstallFinished`. Throws in dev mode, or unless the Plugin is installed
   * with no job.
   */
  uninstall(id: PluginId): void;
  /** An uninstall's answer: the Plugin leaves the Plugin Switcher. Throws unless it is uninstalling. */
  uninstallFinished(id: PluginId): void;
  /**
   * A silent update swapped in: the installed Plugin with `plugin`'s id is now `plugin`, from its
   * next open. Throws unless that Plugin is installed and neither open nor closing.
   */
  updated(plugin: InstalledPlugin): void;
  /**
   * Replaces the unsaved form. Removing the Default AI Provider's provider or model sets the
   * default back to `none`; removing a provider drops any key typed for it. Throws if settings are
   * not showing.
   */
  editSettings(form: HubSettingsForm): void;
  /**
   * Holds a key typed for the provider in `row`, which replaces its key on Save. Throws if settings
   * are not showing or the form has no such row.
   */
  typeAiKey(row: AiProviderRow, key: AiProviderKey): void;
  /**
   * Saves the form through the save callback and makes it what is stored. Does nothing when the
   * form is what is stored and no key was typed, or when it is not valid Hub Settings or an
   * Anthropic provider has no key (the form shows it is not savable). Throws if settings are not
   * showing.
   */
  saveSettings(): void;
  /** Puts the form back to what is stored, dropping typed keys. Throws if settings are not showing. */
  cancelSettings(): void;
  /**
   * The Company Configuration the start's fetch resolved to (spec #99): a `company` Theme follows
   * it at once, with a new snapshot pushed.
   */
  companyConfigured(configuration: CompanyConfiguration): void;
  /** The Hub Settings as last saved, whatever the form holds. */
  storedSettings(): HubSettings;
  /** The installation as a Diagnostics Bundle describes it, on the OS `os`. */
  systemDescription(os: SystemDescription["os"]): SystemDescription;
  /**
   * Opens or closes an open Plugin's Assistant Panel, remembered for it while the Hub runs.
   * Throws unless the Plugin is open and has an Assistant.
   */
  toggleAssistant(id: PluginId): void;
  /**
   * Sends a message in an open Plugin's conversation, with everything before it, and streams the
   * reply through the Plugin's model. Throws unless the Plugin is open with an Assistant and
   * no reply is streaming.
   */
  sendToAssistant(id: PluginId, content: AiContent): void;
  /** Stops a streaming reply, keeping what has arrived. Does nothing when none is streaming. */
  stopAssistant(id: PluginId): void;
  /** Stops any reply and empties the conversation. */
  newConversation(id: PluginId): void;
  /**
   * Sets an open Plugin's Assistant model, saved at once outside Save and Cancel. A provider or
   * model removed later fails its chats with `provider-missing`. Throws unless the Plugin is open
   * with an Assistant.
   */
  chooseModel(id: PluginId, model: AiModelChoice): void;
  /**
   * Stars or unstars an installed Plugin, blocked or not, as a Favourite: saved at once with the
   * stored Hub Settings, outside Save and Cancel. Throws unless the Plugin is installed.
   */
  toggleFavourite(id: PluginId): void;
}

export interface LifecycleDeps {
  hubVersion: HubVersion;
  /** The OS's Display Language (`displayLanguageFor`), which a `system` Display Language follows. */
  systemLanguage: DisplayLanguage;
  installed: readonly InstalledPlugin[];
  storedAtStart: HubSettings;
  /** The cached Company Configuration, or the built-in one, until `companyConfigured`. */
  companyAtStart: CompanyConfiguration;
  /** The labels of the stored AI Providers that have a key in the key store. */
  keyedAtStart: ReadonlySet<AiProviderLabel>;
  /**
   * Writes saved Hub Settings, and each provider's key as `keys` says, and applies them; called
   * only when they changed. Answers the labels that have a key after it.
   */
  save: (
    settings: HubSettings,
    keys: readonly SavedProviderKey[],
  ) => ReadonlySet<AiProviderLabel>;
  assistant: {
    /**
     * An installed Plugin's Assistant context (`assistantContext`): its files read as the Plugin
     * opens, giving the system prompt in the Display Language at each send.
     */
    context: (plugin: InstalledPlugin) => (language: DisplayLanguage) => string;
    /** Starts a chat through the call module (`startAiChat`). */
    chat: (request: AiChatRequest) => AiChat;
    /** Each Plugin's Assistant model as stored (`loadAssistantModels`). */
    modelsAtStart: AssistantModels;
    /** Writes every Plugin's Assistant model (`saveAssistantModels`). */
    saveModels: (models: AssistantModels) => void;
  };
  /** Logs a stored or company Theme this Hub does not have; called once per name. */
  unknownTheme: (name: ThemeName) => void;
  /**
   * `off` in dev mode, which has no Catalogue. `check` starts a Registry check, whose answer comes
   * back through `registryChecked`; the lifecycle calls it only on **Retry**. `install` queues an
   * install, whose answer comes back through `installFinished`; `uninstall` queues an uninstall of a
   * closed Plugin, whose answer comes back through `uninstallFinished`.
   */
  registry:
    | { kind: "off" }
    | {
        kind: "on";
        check: () => void;
        install: (plugin: RegistryPlugin) => void;
        uninstall: (plugin: InstalledPlugin, data: UninstallData) => void;
      };
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
export const HAWKEYE = "hawkeye" as ThemeName;
/** The Themes built into the Hub (ADR 0006): adding one is a Hub release. */
export const THEMES: readonly ThemeName[] = [HAWKEYE];

// The dialog waiting for staff, as the lifecycle holds it: the quit dialog keeps the quit that
// **Quit anyway** goes ahead with, and the Discard dialog the action **Discard** goes ahead with.
type Asking =
  | Extract<HubChromeDialog, { kind: "busy-close" }>
  | (Extract<HubChromeDialog, { kind: "busy-quit" }> & { quit: () => void })
  | { kind: "discard-changes"; proceed: () => void }
  | Extract<HubChromeDialog, { kind: "uninstall" }>;
// A crash message keeps the Plugin's id, not its name: it is named when drawn, so a queued one
// follows a Save that changes the Display Language.
interface CrashMessage {
  kind: "plugin-crashed";
  id: PluginId;
  cause: CrashCause;
}

function dialogOf(
  asking: Asking | CrashMessage | null,
  nameOf: (id: PluginId) => string,
): HubChromeDialog | null {
  if (asking === null) return null;
  switch (asking.kind) {
    case "busy-close":
    case "uninstall":
      return asking;
    case "plugin-crashed":
      return {
        kind: "plugin-crashed",
        plugin: { id: asking.id, name: nameOf(asking.id) },
        cause: asking.cause,
      };
    case "busy-quit":
      return { kind: "busy-quit", plugins: asking.plugins };
    case "discard-changes":
      return { kind: "discard-changes" };
    default:
      return asking satisfies never;
  }
}

export function createLifecycle({
  hubVersion,
  systemLanguage,
  installed,
  storedAtStart,
  companyAtStart,
  keyedAtStart,
  save,
  unknownTheme,
  registry,
  assistant,
}: LifecycleDeps): Lifecycle {
  const languageOf = ({ displayLanguage }: HubSettings): DisplayLanguage => {
    switch (displayLanguage.kind) {
      case "system":
        return systemLanguage;
      case "chosen":
        return displayLanguage.language;
      default:
        return displayLanguage satisfies never;
    }
  };
  // The Hub Settings as last saved. Favourites change here at once; the rest only through Save.
  let stored = storedAtStart;
  // Grows as installs finish, and shrinks as uninstalls do.
  let installedPlugins = [...installed];
  // The Display Language and the installed Plugins named and sorted in it.
  const listingIn = (language: DisplayLanguage) => {
    const byName = new Intl.Collator(language).compare;
    const plugins = installedPlugins
      .map((plugin) => ({
        plugin,
        listed: {
          id: plugin.manifest.id,
          name: displayTextIn(plugin.manifest.name, language),
          iconUrl: pluginIconUrl(plugin.manifest.id),
          access: accessOf(plugin.manifest, HUB_API_VERSION),
          favourite: stored.favourites.includes(plugin.manifest.id),
        },
      }))
      .sort((a, b) => byName(a.listed.name, b.listed.name));
    return { language, plugins, listed: plugins.map(({ listed }) => listed) };
  };
  // Re-derived when a Save changes the Display Language; open Plugin UIs keep theirs (ADR 0007).
  let listing = listingIn(languageOf(storedAtStart));
  const installedPlugin = (id: PluginId) => {
    const plugin = listing.plugins.find(({ listed }) => listed.id === id);
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
  const running = (id: PluginId): boolean =>
    open.includes(id) || closing.includes(id);
  let asking: Asking | null = null;
  // The crash messages not yet dismissed, oldest first. Only the first shows, and only while
  // nothing is asking: a crash never throws away a dialog that is up.
  let crashMessages: CrashMessage[] = [];
  const pendingDialog = (): Asking | CrashMessage | null =>
    asking ?? crashMessages[0] ?? null;
  // Plugins closing behind Hub Settings leave them showing. The language note says open Plugins
  // switch language when reopened, from a Save that changed it while any was open, until staff
  // leave settings or the last open Plugin closes.
  let content:
    | { kind: "plugin" }
    | { kind: "catalogue" }
    | { kind: "settings"; languageNoteShowing: boolean } = {
    kind: "plugin",
  };
  // What the Registry last offered, kept untranslated so a Display Language change re-derives it.
  let offered:
    | { kind: "off" }
    | { kind: "checking" }
    | { kind: "unreachable" }
    | { kind: "listed"; plugins: RegistryPlugin[] } =
    registry.kind === "off" ? { kind: "off" } : { kind: "checking" };
  // Each Plugin's job, queued or running, or its last failed install; none when absent.
  const jobs = new Map<PluginId, Exclude<CatalogueJob, { kind: "none" }>>();
  // Open Plugins staff asked to uninstall: the uninstall dialog asks once each has started closing.
  const askUninstallOnClose = new Set<PluginId>();
  // Confirmed uninstalls of Plugins still closing, with staff's data choice.
  const waitingToClose = new Map<PluginId, UninstallData>();
  // Queues a confirmed uninstall once its Plugin is neither open nor closing.
  const uninstallOnceClosed = (id: PluginId): void => {
    const data = waitingToClose.get(id);
    if (data === undefined || running(id)) return;
    waitingToClose.delete(id);
    registryOn("uninstall").uninstall(installedPlugin(id).plugin, data);
  };
  const catalogueIn = (language: DisplayLanguage): Catalogue => {
    if (offered.kind !== "listed") return offered;
    const byName = new Intl.Collator(language).compare;
    return {
      kind: "listed",
      plugins: offered.plugins
        .map(({ manifest, access }) => {
          const installedVersion = installedPlugins.find(
            (plugin) => plugin.manifest.id === manifest.id,
          )?.manifest.version;
          return {
            id: manifest.id,
            name: displayTextIn(manifest.name, language),
            description: displayTextIn(manifest.description, language),
            iconUrl: registryIconUrl(manifest.id),
            version: manifest.version,
            access,
            installed:
              installedVersion === undefined
                ? { kind: "not-installed" as const }
                : { kind: "installed" as const, version: installedVersion },
            job: jobs.get(manifest.id) ?? { kind: "none" as const },
          };
        })
        .sort((a, b) => byName(a.name, b.name)),
    };
  };
  const registryOn = (operation: string) => {
    if (registry.kind === "off") {
      throw new Error(`${operation}: dev mode has no Plugin Catalogue`);
    }
    return registry;
  };
  let keyed = keyedAtStart;
  // The unsaved form: what is stored until staff edit it.
  let form = formOf(storedAtStart);
  // Keys typed in the form, by row. Held here only: the Hub Chrome learns just which rows have one.
  let typedKeys = new Map<AiProviderRow, AiProviderKey>();
  const resetForm = (): void => {
    form = formOf(stored);
    typedKeys = new Map();
  };
  // Favourites save with what is stored, every key kept with its provider, as an unedited Save
  // would.
  const saveFavourites = (favourites: PluginId[]): void => {
    stored = { ...stored, favourites };
    keyed = save(
      stored,
      stored.aiProviders.map(({ label }) => ({
        label,
        was: { kind: "stored", label },
        key: { kind: "unchanged" },
      })),
    );
    listing = listingIn(listing.language);
  };
  const edited = (): boolean =>
    typedKeys.size > 0 || !isDeepStrictEqual(form, formOf(stored));
  // Picking a Plugin or quitting with unsaved edits asks the Discard dialog first. Edits are only
  // made while settings show, and can only be left behind through **Discard**.
  const discardingEditsFirst = (proceed: () => void): void => {
    if (!edited()) {
      proceed();
      return;
    }
    asking = { kind: "discard-changes", proceed };
    changed();
  };
  // The stored Theme resolved: a name this Hub has no Theme for draws in Hawkeye, and is kept.
  const reported = new Set<ThemeName>();
  let company = companyAtStart;
  const resolveTheme = (setting: HubSettings["theme"]): ThemeName => {
    const name = setting.kind === "company" ? company.theme : setting.name;
    if (THEMES.includes(name)) return name;
    if (!reported.has(name)) {
      reported.add(name);
      unknownTheme(name);
    }
    return HAWKEYE;
  };
  let theme = resolveTheme(stored.theme);
  const settingsShowing = (operation: string) => {
    if (content.kind !== "settings") {
      throw new Error(`${operation} needs Hub Settings showing`);
    }
    return content;
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
      case "discard-changes":
      case "uninstall":
        return asking;
      default:
        return asking satisfies never;
    }
  };
  const uninstallDialog = (id: PluginId): Asking => ({
    kind: "uninstall",
    plugin: { id, name: installedPlugin(id).listed.name },
  });
  // Each open Plugin with an Assistant: its context, read at open, its conversation, and the chat
  // streaming the reply, if one is.
  interface Talk {
    system: (language: DisplayLanguage) => string;
    conversation: Conversation;
    // Null while no reply is streaming: between replies, after one ends, and once it is dropped.
    chat: AiChat | null;
  }
  const talks = new Map<PluginId, Talk>();
  // The Plugins whose Assistant Panel staff left open, while the Hub runs, across closes.
  const panelsOpen = new Set<PluginId>();
  const models = new Map(assistant.modelsAtStart);
  const modelOf = (id: PluginId): AiModelChoice =>
    models.get(id) ?? { kind: "default" };
  const NEW_CONVERSATION: Conversation = {
    messages: [],
    reply: { kind: "idle" },
  };
  const talkOf = (id: PluginId): Talk => {
    const talk = talks.get(id);
    if (talk === undefined) {
      throw new Error(`${id} is not open with an Assistant`);
    }
    return talk;
  };
  // The Plugin's picker choice resolved against the saved Hub Settings, as the call module does.
  const currentModel = (id: PluginId): CurrentModel => {
    const choice = modelOf(id);
    const target = targetOf(stored, choice);
    if (target.kind === "found") {
      const { provider, model } = target;
      return {
        choice,
        kind: "chosen",
        provider: provider.label,
        model: model.id,
        inputs: model.inputs,
      };
    }
    switch (target.failure.code) {
      case "no-provider":
        return { choice, kind: "none" };
      // Only a chosen one can be missing: HubSettingsSchema keeps the Default configured.
      case "provider-missing":
        return { choice, kind: "missing" };
      default:
        return target.failure satisfies never;
    }
  };
  const panelOf = (id: PluginId): AssistantPanel => {
    const talk = talks.get(id);
    if (talk === undefined) return { kind: "none" };
    if (!panelsOpen.has(id)) return { kind: "closed" };
    const { assistant } = installedPlugin(id).plugin.manifest;
    return {
      kind: "open",
      conversation: talk.conversation,
      // A talk is only ever made for a Plugin whose Assistant is enabled.
      templates:
        assistant.kind === "enabled"
          ? assistant.templates.map(({ label, text }) => ({
              label: displayTextIn(label, listing.language),
              text: displayTextIn(text, listing.language),
            }))
          : [],
      model: currentModel(id),
      providers: stored.aiProviders.map(labelAndModels),
    };
  };
  // A chat dropped (by New conversation or a close) is no longer the talk's: nothing more of it
  // shows. A stopped one stays the talk's until it ends, so what had arrived is kept.
  const dropChat = (talk: Talk): void => {
    talk.chat?.cancel();
    talk.chat = null;
  };
  const streamReply = async (talk: Talk, chat: AiChat): Promise<void> => {
    let text = "";
    try {
      for await (const delta of chat.text) {
        if (talk.chat !== chat) return;
        text += delta;
        talk.conversation = {
          ...talk.conversation,
          reply: { kind: "streaming", text },
        };
        // ponytail: a snapshot per delta; batch per animation frame if long replies drag.
        changed();
      }
      const reply = await chat.done;
      if (talk.chat !== chat) return;
      talk.chat = null;
      const { messages } = talk.conversation;
      talk.conversation = {
        // A reply stopped before anything arrived leaves nothing to keep.
        messages:
          reply === ""
            ? messages
            : [
                ...messages,
                { role: "assistant", content: [{ type: "text", text: reply }] },
              ],
        reply: { kind: "idle" },
      };
    } catch (error) {
      // Anything but a failure is a Hub bug: an unhandled rejection, so a Hub crash.
      if (!(error instanceof AiCallFailed)) throw error;
      if (talk.chat !== chat) return;
      talk.chat = null;
      talk.conversation = {
        ...talk.conversation,
        reply: { kind: "failed", failure: error.failure },
      };
    }
    changed();
  };
  const close = (id: PluginId): void => {
    if (!open.includes(id)) {
      throw new Error(`No open Plugin has the id ${JSON.stringify(id)}`);
    }
    open = open.filter((other) => other !== id);
    closing = [...closing, id];
    busyReasons.delete(id);
    const talk = talks.get(id);
    if (talk !== undefined) dropChat(talk);
    talks.delete(id);
    const quitAsked = asking?.kind === "busy-quit" ? asking.quit : null;
    asking = askUninstallOnClose.delete(id)
      ? uninstallDialog(id)
      : askingWithout(id);
    if (open.length === 0 && content.kind === "settings") {
      content = { kind: "settings", languageNoteShowing: false };
    }
    changed();
    // The last Busy Plugin a quit asked about has gone, so nothing Busy is left to ask about: the
    // quit goes ahead, as `requestQuit` does when nothing is Busy. Its crash message, if any, is
    // not shown, since the Hub is quitting; the crash is in the log.
    if (quitAsked !== null && asking === null) quitAsked();
  };
  const requestClose = (id: PluginId): void => {
    const reason = busyReasons.get(id);
    if (reason === undefined) {
      close(id);
      return;
    }
    asking = { kind: "busy-close", plugin: busyPlugin(id, reason) };
    changed();
  };
  return {
    snapshot: () => ({
      displayLanguage: listing.language,
      plugins: listing.listed,
      open: [...open],
      closing: [...closing],
      foreground: open[0] ?? null,
      content:
        content.kind === "settings"
          ? {
              ...content,
              form,
              keysSet: rowsWithKey(form, typedKeys, keyed),
              savable:
                settingsFrom(form, typedKeys, keyed, stored.favourites).kind ===
                "valid",
            }
          : content,
      dialog: dialogOf(
        pendingDialog(),
        (id) => installedPlugin(id).listed.name,
      ),
      hubVersion,
      theme,
      themes: [...THEMES],
      catalogue: catalogueIn(listing.language),
      assistant: open[0] === undefined ? { kind: "none" } : panelOf(open[0]),
    }),
    installed: (id) => installedPlugin(id).plugin,
    running,
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
      if (jobs.get(id)?.kind === "uninstalling") {
        throw new Error(`${id} is uninstalling`);
      }
      discardingEditsFirst(() => {
        const { plugin } = installedPlugin(id);
        if (
          !open.includes(id) &&
          plugin.manifest.assistant.kind === "enabled"
        ) {
          talks.set(id, {
            system: assistant.context(plugin),
            conversation: NEW_CONVERSATION,
            chat: null,
          });
        }
        open = [id, ...open.filter((other) => other !== id)];
        content = { kind: "plugin" };
        changed();
      });
    },
    close,
    crashed: (id, cause) => {
      close(id);
      crashMessages = [...crashMessages, { kind: "plugin-crashed", id, cause }];
      changed();
    },
    closed: (id) => {
      if (!closing.includes(id)) {
        throw new Error(`No closing Plugin has the id ${JSON.stringify(id)}`);
      }
      closing = closing.filter((other) => other !== id);
      changed();
      uninstallOnceClosed(id);
    },
    requestClose,
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
      discardingEditsFirst(() => {
        // In the Plugin Switcher's order.
        const busyPlugins = listing.listed.flatMap(({ id }) => {
          const reason = busyReasons.get(id);
          return reason === undefined ? [] : [busyPlugin(id, reason)];
        });
        if (busyPlugins.length === 0) {
          quit();
          return;
        }
        asking = { kind: "busy-quit", plugins: busyPlugins, quit };
        changed();
      });
    },
    showSettings: () => {
      if (content.kind !== "settings") {
        content = { kind: "settings", languageNoteShowing: false };
      }
      changed();
    },
    showCatalogue: () => {
      registryOn("showCatalogue");
      discardingEditsFirst(() => {
        content = { kind: "catalogue" };
        changed();
      });
    },
    registryChecked: (check) => {
      registryOn("registryChecked");
      switch (check.kind) {
        case "listed":
          offered = { kind: "listed", plugins: check.plugins };
          break;
        case "failed":
          offered = { kind: "unreachable" };
          break;
        default:
          return check satisfies never;
      }
      changed();
    },
    retryRegistry: () => {
      const on = registryOn("retryRegistry");
      if (offered.kind !== "unreachable") {
        throw new Error(
          `Retry needs the Registry unreachable, not ${offered.kind}`,
        );
      }
      offered = { kind: "checking" };
      changed();
      on.check();
    },
    install: (id) => {
      const on = registryOn("install");
      const plugin =
        offered.kind === "listed"
          ? offered.plugins.find(({ manifest }) => manifest.id === id)
          : undefined;
      if (plugin === undefined) {
        throw new Error(`The Registry does not offer ${JSON.stringify(id)}`);
      }
      if (plugin.access.kind === "blocked") {
        throw new Error(`${id} cannot be installed: ${plugin.access.reason}`);
      }
      if (installedPlugins.some(({ manifest }) => manifest.id === id)) {
        throw new Error(`${id} is already installed`);
      }
      if (jobs.get(id)?.kind === "installing") {
        throw new Error(`${id} is already installing`);
      }
      jobs.set(id, { kind: "installing" });
      changed();
      on.install(plugin);
    },
    installFinished: (id, outcome) => {
      registryOn("installFinished");
      if (jobs.get(id)?.kind !== "installing") {
        throw new Error(`${id} is not installing`);
      }
      switch (outcome.kind) {
        case "installed":
          jobs.delete(id);
          installedPlugins = [...installedPlugins, outcome.plugin];
          listing = listingIn(listing.language);
          break;
        case "failed":
          jobs.set(id, { kind: "install-failed", cause: outcome.cause });
          break;
        default:
          return outcome satisfies never;
      }
      changed();
    },
    uninstall: (id) => {
      registryOn("uninstall");
      installedPlugin(id);
      if (jobs.has(id)) {
        throw new Error(`${id} already has a job`);
      }
      if (open.includes(id)) {
        askUninstallOnClose.add(id);
        requestClose(id);
        return;
      }
      asking = uninstallDialog(id);
      changed();
    },
    uninstallFinished: (id) => {
      registryOn("uninstallFinished");
      if (jobs.get(id)?.kind !== "uninstalling" || waitingToClose.has(id)) {
        throw new Error(`${id} is not uninstalling`);
      }
      jobs.delete(id);
      installedPlugins = installedPlugins.filter(
        ({ manifest }) => manifest.id !== id,
      );
      listing = listingIn(listing.language);
      if (stored.favourites.includes(id)) {
        saveFavourites(stored.favourites.filter((other) => other !== id));
      }
      // A crash message names its Plugin when drawn, so one still up for it goes with it.
      crashMessages = crashMessages.filter((message) => message.id !== id);
      changed();
    },
    updated: (plugin) => {
      const { id } = plugin.manifest;
      installedPlugin(id);
      if (running(id)) {
        throw new Error(`${id} cannot be updated while it is open`);
      }
      installedPlugins = installedPlugins.map((other) =>
        other.manifest.id === id ? plugin : other,
      );
      listing = listingIn(listing.language);
      changed();
    },
    editSettings: (next) => {
      settingsShowing("editSettings");
      const rows = new Set(next.aiProviders.map(({ row }) => row));
      const { defaultAiProvider } = next;
      form =
        defaultAiProvider.kind === "chosen" &&
        next.aiProviders
          .find(({ row }) => row === defaultAiProvider.provider)
          ?.models.some(({ id }) => id === defaultAiProvider.model) !== true
          ? { ...next, defaultAiProvider: { kind: "none" } }
          : next;
      typedKeys = new Map([...typedKeys].filter(([row]) => rows.has(row)));
      changed();
    },
    typeAiKey: (row, key) => {
      settingsShowing("typeAiKey");
      if (!form.aiProviders.some((each) => each.row === row)) {
        throw new Error(`The form has no AI Provider row ${row}`);
      }
      typedKeys.set(row, key);
      changed();
    },
    saveSettings: () => {
      const showing = settingsShowing("saveSettings");
      if (!edited()) return;
      const valid = settingsFrom(form, typedKeys, keyed, stored.favourites);
      if (valid.kind === "invalid") return;
      keyed = save(valid.settings, valid.keys);
      stored = valid.settings;
      resetForm();
      const language = languageOf(stored);
      if (language !== listing.language) {
        listing = listingIn(language);
        if (open.length > 0) {
          content = { ...showing, languageNoteShowing: true };
        }
      }
      theme = resolveTheme(stored.theme);
      changed();
    },
    cancelSettings: () => {
      settingsShowing("cancelSettings");
      resetForm();
      changed();
    },
    companyConfigured: (configuration) => {
      company = configuration;
      theme = resolveTheme(stored.theme);
      changed();
    },
    storedSettings: () => stored,
    systemDescription: (os) => ({
      hubVersion,
      os,
      displayLanguage: listing.language,
      theme,
      colourScheme: stored.colourScheme,
      plugins: listing.plugins.map(({ plugin }) => pluginRefOf(plugin)),
      // ponytail: uv's interpreters are not listed yet; read `uv/python` if support asks. There is
      // no sign-in until the sign-in spec.
      pythonVersions: [],
      aiProviders: stored.aiProviders.map(({ label, endpoint }) => ({
        label,
        kind: endpoint.kind,
      })),
      authProvider: describeAuthProvider(company.authProvider),
    }),
    toggleAssistant: (id) => {
      talkOf(id);
      if (!panelsOpen.delete(id)) panelsOpen.add(id);
      changed();
    },
    sendToAssistant: (id, content) => {
      const talk = talkOf(id);
      if (talk.chat !== null) {
        throw new Error(`${id}'s Assistant is still replying`);
      }
      const messages = [
        ...talk.conversation.messages,
        { role: "user" as const, content },
      ];
      const chat = assistant.chat({
        model: modelOf(id),
        system: talk.system(listing.language),
        messages,
      });
      talk.chat = chat;
      talk.conversation = { messages, reply: { kind: "streaming", text: "" } };
      changed();
      void streamReply(talk, chat);
    },
    stopAssistant: (id) => {
      talkOf(id).chat?.cancel();
    },
    newConversation: (id) => {
      const talk = talkOf(id);
      dropChat(talk);
      talk.conversation = NEW_CONVERSATION;
      changed();
    },
    chooseModel: (id, model) => {
      talkOf(id);
      models.set(id, model);
      assistant.saveModels(models);
      changed();
    },
    toggleFavourite: (id) => {
      installedPlugin(id);
      saveFavourites(
        stored.favourites.includes(id)
          ? stored.favourites.filter((other) => other !== id)
          : [...stored.favourites, id],
      );
      changed();
    },
    answer: (answer) => {
      const pending = pendingDialog();
      if (pending === null)
        throw new Error("No dialog is waiting for an answer");
      if (answer === KEEP_ANSWERS[pending.kind]) {
        if (pending.kind === "plugin-crashed") {
          crashMessages = crashMessages.slice(1);
        } else {
          asking = null;
        }
        // Keeping a Busy Plugin open keeps it installed too.
        if (pending.kind === "busy-close") {
          askUninstallOnClose.delete(pending.plugin.id);
        }
        changed();
        return;
      }
      if (
        pending.kind === "uninstall" &&
        (answer === "uninstall" || answer === "uninstall-and-delete-data")
      ) {
        const { id } = pending.plugin;
        asking = null;
        jobs.set(id, { kind: "uninstalling" });
        waitingToClose.set(
          id,
          answer === "uninstall" ? "keep-data" : "delete-data",
        );
        changed();
        // Not open: it was closed before this dialog asked, and the dialog is modal.
        uninstallOnceClosed(id);
        return;
      }
      if (pending.kind === "discard-changes" && answer === "discard") {
        asking = null;
        resetForm();
        // Announced before going ahead, as **Quit anyway** is: the Busy quit dialog it may ask
        // next comes up on a fresh overlay.
        changed();
        pending.proceed();
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
