import {
  parseManifest,
  PluginId,
  type Manifest,
} from "@hawkeye-hub/plugin-format";
import { expect, test, vi } from "vitest";
import type { AiChatRequest } from "../shared/ai-call";
import { AiCallFailed, type AiChat, type AiFailure } from "./ai";
import {
  parseAbsolutePath,
  parseAiProviderLabel,
  parseHubApiVersion,
  parseHubVersion,
} from "./ids";
import type {
  BusyReason,
  HubSettings,
  ThemeName,
} from "../shared/hub-chrome-ipc";
import type { AiProviderDraft, AiProviderRow } from "../shared/hub-settings";
import { keysAfterSave, parseAiProviderKey, type AiKeys } from "./ai-keys";
import { FIRST_LAUNCH_SETTINGS } from "./hub-settings";
import type { AiProviderLabel } from "./ids";
import { formOf } from "./settings-form";
import {
  accessOf,
  createLifecycle,
  type Busy,
  type Lifecycle,
  type LifecycleDeps,
} from "./lifecycle";
import type { RegistryPlugin } from "./registry";
import type { AssistantModels } from "./assistant-models";

function installed(
  id: string,
  name: unknown,
  overrides: { hubApi?: string; identity?: unknown; assistant?: unknown } = {},
) {
  const parsed = parseManifest({
    id,
    version: "1.0.0",
    hubApi: "^1.0.0",
    name,
    description: "A fixture.",
    platforms: ["win32-x64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "none" },
    assistant: { kind: "none" },
    ...overrides,
  });
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  const manifest: Manifest = parsed.manifest;
  return { folder: parseAbsolutePath(`/plugins/${id}@1.0.0`), manifest };
}

const id = (raw: string): PluginId => PluginId.parse(raw);
const busy = (reason: string): Busy => ({
  kind: "busy",
  reason: reason as BusyReason,
});
const NOT_BUSY: Busy = { kind: "not-busy" };
// Dev mode: no Catalogue and no Registry checks. Most tests are not about the Catalogue.
const DEV_MODE: LifecycleDeps["registry"] = { kind: "off" };
const HUB_VERSION = parseHubVersion("1.4.2");
// Most tests never save.
const ignoreSave = () => new Set<AiProviderLabel>();
const ignoreUnknownTheme = (): void => {
  // Most tests store only Themes this Hub has.
};
// Most tests open no Plugin with an Assistant.
const NO_ASSISTANT: LifecycleDeps["assistant"] = {
  context: () => {
    throw new Error("No Assistant here");
  },
  chat: () => {
    throw new Error("No Assistant here");
  },
  modelsAtStart: new Map(),
  saveModels: () => {
    throw new Error("No Assistant here");
  },
};

const plugins = [
  installed("class-timer", { "en-HK": "Timer", "zh-HK": "計時器" }),
  installed("attendance", { "en-HK": "Attendance", "zh-HK": "點名" }),
  installed("seating-plan", "Seating Plan"),
];

test("the snapshot lists every installed Plugin by its en-HK name and icon URL, sorted", () => {
  expect(
    createLifecycle({
      hubVersion: HUB_VERSION,
      systemLanguage: "en-HK",
      installed: plugins,
      storedAtStart: FIRST_LAUNCH_SETTINGS,
      keyedAtStart: new Set(),
      save: ignoreSave,
      unknownTheme: ignoreUnknownTheme,
      assistant: NO_ASSISTANT,
      registry: DEV_MODE,
    }).snapshot(),
  ).toEqual({
    displayLanguage: "en-HK",
    plugins: [
      {
        id: "attendance",
        name: "Attendance",
        iconUrl: "hawkeye-icon://attendance/icon.svg",
        access: { kind: "openable" },
      },
      {
        id: "seating-plan",
        name: "Seating Plan",
        iconUrl: "hawkeye-icon://seating-plan/icon.svg",
        access: { kind: "openable" },
      },
      {
        id: "class-timer",
        name: "Timer",
        iconUrl: "hawkeye-icon://class-timer/icon.svg",
        access: { kind: "openable" },
      },
    ],
    open: [],
    closing: [],
    foreground: null,
    content: { kind: "plugin" },
    dialog: null,
    hubVersion: "1.4.2",
    theme: "hawkeye",
    themes: ["hawkeye"],
    catalogue: { kind: "off" },
    assistant: { kind: "none" },
  });
});

test("in zh-HK the snapshot uses zh-HK names, falls back to English, and sorts by them", () => {
  expect(
    createLifecycle({
      hubVersion: HUB_VERSION,
      systemLanguage: "zh-HK",
      installed: plugins,
      storedAtStart: FIRST_LAUNCH_SETTINGS,
      keyedAtStart: new Set(),
      save: ignoreSave,
      unknownTheme: ignoreUnknownTheme,
      assistant: NO_ASSISTANT,
      registry: DEV_MODE,
    })
      .snapshot()
      .plugins.map(({ name }) => name),
    // ICU's zh-HK collation: Han by stroke count (計 9, 點 17), then Latin.
  ).toEqual(["計時器", "點名", "Seating Plan"]);
});

test("showing settings keeps open Plugins open with the front one still in front, and lists no new Plugin", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));
  const before = lifecycle.snapshot();
  const seen: string[] = [];
  lifecycle.onChange(() => {
    seen.push(lifecycle.snapshot().content.kind);
  });

  lifecycle.showSettings();
  expect(lifecycle.snapshot()).toEqual({
    ...before,
    content: {
      kind: "settings",
      form: formOf(FIRST_LAUNCH_SETTINGS),
      keysSet: [],
      savable: true,
      languageNoteShowing: false,
    },
  });
  expect(seen).toEqual(["settings"]);
});

const DARK: HubSettings = { ...FIRST_LAUNCH_SETTINGS, colourScheme: "dark" };
const LIGHT: HubSettings = { ...FIRST_LAUNCH_SETTINGS, colourScheme: "light" };

/** A Lifecycle showing settings, starting from `stored`, and the settings each Save saved. */
function inSettings(stored: HubSettings, storedKeys: AiKeys = new Map()) {
  const saved: HubSettings[] = [];
  const unknownThemes: string[] = [];
  // The key store, as main's Save writes it.
  let keys = storedKeys;
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: stored,
    keyedAtStart: new Set(keys.keys()),
    save: (settings, providerKeys) => {
      saved.push(settings);
      keys = keysAfterSave(keys, providerKeys);
      return new Set(keys.keys());
    },
    unknownTheme: (name) => {
      unknownThemes.push(name);
    },
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.showSettings();
  return { lifecycle, saved, unknownThemes, keys: () => keys };
}

const themeNamed = (name: string): HubSettings["theme"] => ({
  kind: "chosen",
  name: name as ThemeName,
});

test("on first launch the company's Theme, Hawkeye until the Company Configuration is fetched, is the Theme", () => {
  const { lifecycle, unknownThemes } = inSettings(FIRST_LAUNCH_SETTINGS);
  expect(lifecycle.snapshot()).toMatchObject({
    theme: "hawkeye",
    themes: ["hawkeye"],
  });
  expect(lifecycle.storedSettings().theme).toEqual({ kind: "company" });
  expect(unknownThemes).toEqual([]);
});

test("saving a chosen Theme stores it by name and makes it the Theme", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  const chosen = { ...FIRST_LAUNCH_SETTINGS, theme: themeNamed("hawkeye") };
  lifecycle.editSettings(formOf(chosen));
  lifecycle.saveSettings();
  expect(saved).toEqual([chosen]);
  expect(lifecycle.snapshot().theme).toBe("hawkeye");
  expect(lifecycle.storedSettings().theme).toEqual(themeNamed("hawkeye"));
});

test("a stored Theme this Hub does not have resolves to Hawkeye, is reported once, and stays stored", () => {
  const stored = { ...FIRST_LAUNCH_SETTINGS, theme: themeNamed("aurora") };
  const { lifecycle, saved, unknownThemes } = inSettings(stored);
  expect(lifecycle.snapshot().theme).toBe("hawkeye");

  lifecycle.editSettings(formOf({ ...stored, colourScheme: "dark" }));
  lifecycle.saveSettings();
  lifecycle.snapshot();
  expect(unknownThemes).toEqual(["aurora"]);
  expect(saved).toEqual([{ ...stored, colourScheme: "dark" }]);
  expect(lifecycle.storedSettings().theme).toEqual(themeNamed("aurora"));
  expect(lifecycle.snapshot().theme).toBe("hawkeye");
});

test("settings show what is stored", () => {
  const { lifecycle } = inSettings(DARK);
  expect(lifecycle.snapshot().content).toEqual({
    kind: "settings",
    form: formOf(DARK),
    keysSet: [],
    savable: true,
    languageNoteShowing: false,
  });
});

test("editing the form changes only the form, and saves nothing", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  const seen: unknown[] = [];
  lifecycle.onChange(() => {
    seen.push(lifecycle.snapshot().content);
  });

  lifecycle.editSettings(formOf(DARK));
  const edited = {
    kind: "settings",
    form: formOf(DARK),
    keysSet: [],
    savable: true,
    languageNoteShowing: false,
  };
  expect(lifecycle.snapshot().content).toEqual(edited);
  expect(seen).toEqual([edited]);
  expect(saved).toEqual([]);
});

test("Save saves the form once and makes it what is stored", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(formOf(DARK));

  lifecycle.saveSettings();
  expect(saved).toEqual([DARK]);
  expect(lifecycle.snapshot().content).toEqual({
    kind: "settings",
    form: formOf(DARK),
    keysSet: [],
    savable: true,
    languageNoteShowing: false,
  });
  expect(lifecycle.storedSettings()).toEqual(DARK);

  lifecycle.saveSettings();
  expect(saved).toEqual([DARK]);
});

test("Save does nothing when the form is what is stored, even after edits that undo each other", () => {
  const { lifecycle, saved } = inSettings(DARK);
  const before = lifecycle.snapshot();
  lifecycle.saveSettings();
  lifecycle.editSettings(formOf(LIGHT));
  lifecycle.editSettings(formOf({ ...DARK }));
  lifecycle.saveSettings();

  expect(saved).toEqual([]);
  expect(lifecycle.snapshot()).toEqual(before);
});

test("Cancel puts the form back to what is stored and stays in settings", () => {
  const { lifecycle, saved } = inSettings(DARK);
  lifecycle.editSettings(formOf(LIGHT));

  lifecycle.cancelSettings();
  expect(lifecycle.snapshot().content).toEqual({
    kind: "settings",
    form: formOf(DARK),
    keysSet: [],
    savable: true,
    languageNoteShowing: false,
  });
  expect(saved).toEqual([]);
});

test("a fresh snapshot, as a reloaded Hub Chrome fetches, still holds the unsaved form", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(formOf(LIGHT));
  expect(lifecycle.snapshot().content).toMatchObject({ form: formOf(LIGHT) });
});

// AI Providers in Hub Settings (#106).

const row = (raw: string) => raw as AiProviderRow;
const label = parseAiProviderLabel;
const key = parseAiProviderKey;
const OLLAMA: AiProviderDraft = {
  row: row("new"),
  was: { kind: "added" },
  label: "Ollama",
  endpoint: { kind: "openai-compatible", baseUrl: "http://localhost:11434/v1" },
  models: [{ id: "llama4", acceptsImages: false }],
};
const WITH_CLAUDE: HubSettings = {
  ...FIRST_LAUNCH_SETTINGS,
  aiProviders: [
    {
      label: label("Claude"),
      endpoint: { kind: "anthropic" },
      models: [{ id: "claude-opus-5-5", acceptsImages: true }],
    },
  ],
  defaultAiProvider: {
    kind: "chosen",
    provider: label("Claude"),
    model: "claude-opus-5-5",
  },
};
const CLAUDE_KEY = new Map([[label("Claude"), key("sk-ant-stored")]]);

test("a provider added with a key is saved, its key goes to the key store, and the form shows only that a key is set", () => {
  const { lifecycle, saved, keys } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings({
    ...formOf(FIRST_LAUNCH_SETTINGS),
    aiProviders: [OLLAMA],
  });
  lifecycle.typeAiKey(row("new"), key("sk-typed"));
  expect(lifecycle.snapshot().content).toMatchObject({
    keysSet: ["new"],
    savable: true,
  });
  expect(JSON.stringify(lifecycle.snapshot())).not.toContain("sk-typed");

  lifecycle.saveSettings();
  expect(saved).toEqual([
    {
      ...FIRST_LAUNCH_SETTINGS,
      aiProviders: [
        {
          label: "Ollama",
          endpoint: OLLAMA.endpoint,
          models: OLLAMA.models,
        },
      ],
    },
  ]);
  expect(keys()).toEqual(new Map([["Ollama", "sk-typed"]]));
  expect(lifecycle.snapshot().content).toMatchObject({
    form: { aiProviders: [{ was: { kind: "stored", label: "Ollama" } }] },
    keysSet: ["0"],
  });
});

test("a stored provider shows its key as set, and renaming it moves the key and keeps it the default", () => {
  const { lifecycle, saved, keys } = inSettings(WITH_CLAUDE, CLAUDE_KEY);
  const form = formOf(WITH_CLAUDE);
  expect(lifecycle.snapshot().content).toMatchObject({ keysSet: ["0"] });
  expect(JSON.stringify(lifecycle.snapshot())).not.toContain("sk-ant-stored");

  lifecycle.editSettings({
    ...form,
    aiProviders: form.aiProviders.map((each) => ({
      ...each,
      label: "Anthropic",
    })),
  });
  lifecycle.saveSettings();
  expect(saved[0]?.defaultAiProvider).toEqual({
    kind: "chosen",
    provider: "Anthropic",
    model: "claude-opus-5-5",
  });
  expect(keys()).toEqual(new Map([["Anthropic", "sk-ant-stored"]]));
});

test("a typed key replaces the stored one", () => {
  const { lifecycle, keys } = inSettings(WITH_CLAUDE, CLAUDE_KEY);
  lifecycle.typeAiKey(row("0"), key("sk-ant-new"));
  lifecycle.saveSettings();
  expect(keys()).toEqual(new Map([["Claude", "sk-ant-new"]]));
});

test("removing the default provider sets the default back to none, and its key goes on Save", () => {
  const { lifecycle, saved, keys } = inSettings(WITH_CLAUDE, CLAUDE_KEY);
  lifecycle.editSettings({ ...formOf(WITH_CLAUDE), aiProviders: [] });
  expect(lifecycle.snapshot().content).toMatchObject({
    form: { defaultAiProvider: { kind: "none" } },
    keysSet: [],
  });
  lifecycle.saveSettings();
  expect(saved).toEqual([FIRST_LAUNCH_SETTINGS]);
  expect(keys()).toEqual(new Map());
});

test("removing the default's model sets the default back to none", () => {
  const { lifecycle } = inSettings(WITH_CLAUDE, CLAUDE_KEY);
  const form = formOf(WITH_CLAUDE);
  lifecycle.editSettings({
    ...form,
    aiProviders: form.aiProviders.map((each) => ({
      ...each,
      models: [{ id: "claude-sonnet-5", acceptsImages: true }],
    })),
  });
  expect(lifecycle.snapshot().content).toMatchObject({
    form: { defaultAiProvider: { kind: "none" } },
    savable: true,
  });
});

test("Save refuses a form that is not valid Hub Settings, and saves nothing", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings({
    ...formOf(FIRST_LAUNCH_SETTINGS),
    aiProviders: [{ ...OLLAMA, label: " ", models: [] }],
  });
  expect(lifecycle.snapshot().content).toMatchObject({ savable: false });
  lifecycle.saveSettings();
  expect(saved).toEqual([]);
  expect(lifecycle.snapshot().content).toMatchObject({ savable: false });
});

test("Save refuses an Anthropic provider with no key, so the SDK never reads one from the environment", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(formOf(WITH_CLAUDE));
  expect(lifecycle.snapshot().content).toMatchObject({ savable: false });
  lifecycle.saveSettings();
  expect(saved).toEqual([]);

  lifecycle.typeAiKey(row("0"), key("sk-ant-typed"));
  expect(lifecycle.snapshot().content).toMatchObject({ savable: true });
  lifecycle.saveSettings();
  expect(saved).toEqual([WITH_CLAUDE]);
});

test("Cancel drops AI Provider edits and typed keys", () => {
  const { lifecycle, saved } = inSettings(WITH_CLAUDE);
  lifecycle.typeAiKey(row("0"), key("sk-ant-typed"));
  expect(lifecycle.snapshot().content).toMatchObject({ keysSet: ["0"] });
  lifecycle.cancelSettings();
  expect(lifecycle.snapshot().content).toMatchObject({
    form: formOf(WITH_CLAUDE),
    keysSet: [],
  });
  lifecycle.saveSettings();
  expect(saved).toEqual([]);
});

test("a typed key alone is an unsaved edit the Discard dialog asks about", () => {
  const { lifecycle } = inSettings(WITH_CLAUDE);
  lifecycle.typeAiKey(row("0"), key("sk-ant-typed"));
  lifecycle.open(id("attendance"));
  expect(lifecycle.snapshot().dialog).toEqual({ kind: "discard-changes" });
  lifecycle.answer("discard");
  lifecycle.showSettings();
  expect(lifecycle.snapshot().content).toMatchObject({ keysSet: [] });
});

test("typing a key for a row the form does not have throws", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  expect(() => {
    lifecycle.typeAiKey(row("0"), key("sk"));
  }).toThrow();
});

test("picking a Plugin while settings show leaves them and brings that Plugin forward", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));
  lifecycle.showSettings();

  lifecycle.open(id("class-timer"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer", "attendance"],
    foreground: "class-timer",
    content: { kind: "plugin" },
  });
});

test("settings stay showing while the Plugins behind them close", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("attendance"));
  lifecycle.showSettings();

  lifecycle.close(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    foreground: null,
    content: { kind: "settings" },
  });
});

test("editing, saving or cancelling while settings are not showing throws", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  expect(() => {
    lifecycle.editSettings(formOf(DARK));
  }).toThrow();
  expect(() => {
    lifecycle.saveSettings();
  }).toThrow();
  expect(() => {
    lifecycle.cancelSettings();
  }).toThrow();
});

function openAndForeground(lifecycle: Lifecycle) {
  const { open, foreground } = lifecycle.snapshot();
  return { open, foreground };
}

test("opening Plugins brings each forward, and opening an open one brings it forward without a second copy", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  expect(openAndForeground(lifecycle)).toEqual({ open: [], foreground: null });

  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));
  expect(openAndForeground(lifecycle)).toEqual({
    open: ["attendance", "class-timer"],
    foreground: "attendance",
  });

  lifecycle.open(id("class-timer"));
  expect(openAndForeground(lifecycle)).toEqual({
    open: ["class-timer", "attendance"],
    foreground: "class-timer",
  });
});

test("closing the foreground Plugin brings forward the most recently foregrounded one, then nothing", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.open(id("seating-plan"));
  lifecycle.open(id("attendance"));
  lifecycle.open(id("class-timer"));

  lifecycle.close(id("class-timer"));
  expect(lifecycle.snapshot().foreground).toBe("attendance");
  lifecycle.close(id("attendance"));
  expect(lifecycle.snapshot().foreground).toBe("seating-plan");
  lifecycle.close(id("seating-plan"));
  expect(openAndForeground(lifecycle)).toEqual({ open: [], foreground: null });
});

test("closing a background Plugin leaves the foreground one in front", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));

  lifecycle.close(id("class-timer"));
  expect(openAndForeground(lifecycle)).toEqual({
    open: ["attendance"],
    foreground: "attendance",
  });
});

test("every change is announced", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  const seen: (string | null)[] = [];
  lifecycle.onChange(() => {
    seen.push(lifecycle.snapshot().foreground);
  });

  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));
  lifecycle.close(id("attendance"));

  expect(seen).toEqual(["class-timer", "attendance", "class-timer"]);
});

test("a closed Plugin is closing until its close finishes, cannot be reopened until then, and then reopens", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));

  lifecycle.close(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    closing: ["attendance"],
    foreground: "class-timer",
  });
  expect(() => {
    lifecycle.open(id("attendance"));
  }).toThrow();

  lifecycle.closed(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    closing: [],
  });
  lifecycle.open(id("attendance"));
  expect(lifecycle.snapshot().foreground).toBe("attendance");
});

test("finishing the close of a Plugin that is not closing throws", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("attendance"));
  expect(() => {
    lifecycle.closed(id("attendance"));
  }).toThrow();
});

test("a staff close of a Plugin that is not Busy closes it without asking", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("attendance"));

  lifecycle.requestClose(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    closing: ["attendance"],
    dialog: null,
  });
});

test("a staff close of a Busy Plugin asks with its latest reason; Keep open leaves it open", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing a test"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));

  lifecycle.requestClose(id("class-timer"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    dialog: {
      kind: "busy-close",
      plugin: { id: "class-timer", name: "Timer", reason: "Timing an exam" },
    },
  });

  lifecycle.answer("keep-open");
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    closing: [],
    dialog: null,
  });
});

test("Close anyway closes the Busy Plugin, and closing clears its Busy", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.requestClose(id("class-timer"));

  lifecycle.answer("close-anyway");
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    closing: ["class-timer"],
    dialog: null,
  });

  lifecycle.closed(id("class-timer"));
  lifecycle.open(id("class-timer"));
  lifecycle.requestClose(id("class-timer"));
  expect(lifecycle.snapshot()).toMatchObject({ open: [], dialog: null });
});

test("a Plugin that clears Busy closes without asking, but a dialog already up stays", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.setBusy(id("attendance"), busy("Taking the register"));
  lifecycle.setBusy(id("attendance"), NOT_BUSY);
  lifecycle.requestClose(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    dialog: null,
  });

  lifecycle.requestClose(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), NOT_BUSY);
  expect(lifecycle.snapshot().dialog).toMatchObject({
    kind: "busy-close",
    plugin: { reason: "Timing an exam" },
  });
});

test("a Busy Plugin that closes abnormally while its dialog is up takes the dialog with it", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.requestClose(id("class-timer"));

  lifecycle.close(id("class-timer"));
  expect(lifecycle.snapshot()).toMatchObject({
    closing: ["class-timer"],
    dialog: null,
  });
});

test("a Busy Plugin that closes abnormally while the quit dialog is up leaves its list, and the last one takes the dialog with it", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.setBusy(id("attendance"), busy("Taking the register"));
  let quits = 0;
  lifecycle.requestQuit(() => {
    quits += 1;
  });

  lifecycle.close(id("attendance"));
  expect(lifecycle.snapshot().dialog).toEqual({
    kind: "busy-quit",
    plugins: [{ id: "class-timer", name: "Timer", reason: "Timing an exam" }],
  });
  lifecycle.close(id("class-timer"));
  expect(lifecycle.snapshot().dialog).toBeNull();
  expect(quits).toBe(0);
});

test("a Busy reason that changes while its dialog is up leaves the dialog as it was asked", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing a test"));
  lifecycle.requestQuit(() => undefined);

  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  expect(lifecycle.snapshot().dialog).toMatchObject({
    plugins: [{ reason: "Timing a test" }],
  });
});

test("Busy from a Plugin that is not open is ignored: it arrived as the Plugin closed", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.close(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.closed(id("class-timer"));

  lifecycle.open(id("class-timer"));
  lifecycle.requestClose(id("class-timer"));
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("a quit with no Busy Plugin goes ahead without asking", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  let quits = 0;

  lifecycle.requestQuit(() => {
    quits += 1;
  });
  expect(quits).toBe(1);
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("a quit with Busy Plugins asks once, listing each by name; Keep open stays, Quit anyway quits", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));
  lifecycle.open(id("seating-plan"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.setBusy(id("attendance"), busy("Taking the register"));
  let quits = 0;
  const quit = () => {
    quits += 1;
  };

  lifecycle.requestQuit(quit);
  expect(lifecycle.snapshot().dialog).toEqual({
    kind: "busy-quit",
    plugins: [
      { id: "attendance", name: "Attendance", reason: "Taking the register" },
      { id: "class-timer", name: "Timer", reason: "Timing an exam" },
    ],
  });
  lifecycle.answer("keep-open");
  expect(quits).toBe(0);
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["seating-plan", "attendance", "class-timer"],
    dialog: null,
  });

  lifecycle.requestQuit(quit);
  lifecycle.answer("quit-anyway");
  expect(quits).toBe(1);
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("a quit while a Busy close is asking asks about the quit instead", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.requestClose(id("class-timer"));

  lifecycle.requestQuit(() => undefined);
  expect(lifecycle.snapshot().dialog).toMatchObject({ kind: "busy-quit" });
});

test("an answer that is not one of the pending dialog's buttons, or with no dialog, throws", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  expect(() => {
    lifecycle.answer("keep-open");
  }).toThrow();
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.requestClose(id("class-timer"));
  expect(() => {
    lifecycle.answer("quit-anyway");
  }).toThrow();
});

test("opening a Plugin that is not installed, or closing one that is not open, throws", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  expect(() => {
    lifecycle.open(id("not-installed"));
  }).toThrow();
  expect(() => {
    lifecycle.close(id("attendance"));
  }).toThrow();
});

const HUB_API = parseHubApiVersion("1.4.0");

function accessWith(overrides: { hubApi?: string; identity?: unknown }) {
  return accessOf(installed("gated", "Gated", overrides).manifest, HUB_API);
}

test("a Plugin needing no identity, with a hubApi range this Hub satisfies, is openable", () => {
  expect(accessWith({ hubApi: "^1.2.0" })).toEqual({ kind: "openable" });
});

test("a Plugin that requires a Staff Identity is blocked: there is no Auth Provider", () => {
  expect(accessWith({ identity: { kind: "required", roles: [] } })).toEqual({
    kind: "blocked",
    reason: "needs-sign-in",
  });
});

test.each([
  ["too new for the Plugin", "~1.2.0"],
  ["too new for the Plugin", "<1.4.0"],
  ["too old for the Plugin", "^1.5.0"],
  ["too old for the Plugin", "^2.0.0"],
])("a Hub %s (range %s) blocks the Plugin", (_, hubApi) => {
  expect(accessWith({ hubApi })).toEqual({
    kind: "blocked",
    reason: "needs-different-hub",
  });
});

test("the snapshot marks blocked Plugins, and opening one throws", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: [
      installed("sign-in", "Sign In", {
        identity: { kind: "required", roles: [] },
      }),
      installed("future", "Future", { hubApi: "^99.0.0" }),
    ],
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  expect(
    lifecycle.snapshot().plugins.map(({ id, access }) => ({ id, access })),
  ).toEqual([
    {
      id: "future",
      access: { kind: "blocked", reason: "needs-different-hub" },
    },
    { id: "sign-in", access: { kind: "blocked", reason: "needs-sign-in" } },
  ]);
  expect(() => {
    lifecycle.open(id("sign-in"));
  }).toThrow();
  expect(() => {
    lifecycle.open(id("future"));
  }).toThrow();
  expect(lifecycle.snapshot().open).toEqual([]);
});

test("installed answers the installed Plugin with an id, and throws for one that is not installed", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  expect(lifecycle.installed(id("attendance"))).toBe(plugins[1]);
  expect(() => lifecycle.installed(id("not-installed"))).toThrow();
});

test("picking a Plugin with unsaved edits asks first; Keep editing stays with the edits", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(formOf(DARK));

  lifecycle.open(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    content: { kind: "settings", form: formOf(DARK) },
    dialog: { kind: "discard-changes" },
  });

  lifecycle.answer("keep-editing");
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    content: { kind: "settings", form: formOf(DARK) },
    dialog: null,
  });
});

test("Discard drops the edits and opens the Plugin that was picked", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(formOf(DARK));
  lifecycle.open(id("attendance"));

  lifecycle.answer("discard");
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["attendance"],
    foreground: "attendance",
    content: { kind: "plugin" },
    dialog: null,
  });
  lifecycle.showSettings();
  expect(lifecycle.snapshot().content).toMatchObject({
    form: formOf(FIRST_LAUNCH_SETTINGS),
  });
  expect(saved).toEqual([]);
});

test("picking a Plugin after edits that were undone or saved asks nothing", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(formOf(DARK));
  lifecycle.editSettings(formOf(FIRST_LAUNCH_SETTINGS));
  lifecycle.open(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["attendance"],
    dialog: null,
  });

  lifecycle.showSettings();
  lifecycle.editSettings(formOf(DARK));
  lifecycle.saveSettings();
  lifecycle.open(id("class-timer"));
  expect(lifecycle.snapshot()).toMatchObject({
    foreground: "class-timer",
    dialog: null,
  });
});

test("picking a blocked Plugin with unsaved edits throws rather than asking", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: [installed("future", "Future", { hubApi: "^99.0.0" })],
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  lifecycle.showSettings();
  lifecycle.editSettings(formOf(DARK));
  expect(() => {
    lifecycle.open(id("future"));
  }).toThrow();
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("quitting with unsaved edits asks first; Keep editing stays, Discard quits when nothing is Busy", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(formOf(DARK));
  let quits = 0;
  const quit = () => {
    quits += 1;
  };

  lifecycle.requestQuit(quit);
  expect(lifecycle.snapshot().dialog).toEqual({ kind: "discard-changes" });
  lifecycle.answer("keep-editing");
  expect(quits).toBe(0);
  expect(lifecycle.snapshot()).toMatchObject({
    content: { kind: "settings", form: formOf(DARK) },
    dialog: null,
  });

  lifecycle.requestQuit(quit);
  lifecycle.answer("discard");
  expect(quits).toBe(1);
  expect(lifecycle.snapshot()).toMatchObject({
    content: { form: formOf(FIRST_LAUNCH_SETTINGS) },
    dialog: null,
  });
  expect(saved).toEqual([]);
});

test("Discard on quit goes on to the Busy dialog when a Plugin is Busy", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.showSettings();
  lifecycle.editSettings(formOf(DARK));
  let quits = 0;

  lifecycle.requestQuit(() => {
    quits += 1;
  });
  lifecycle.answer("discard");
  expect(quits).toBe(0);
  expect(lifecycle.snapshot().dialog).toEqual({
    kind: "busy-quit",
    plugins: [{ id: "class-timer", name: "Timer", reason: "Timing an exam" }],
  });

  lifecycle.answer("quit-anyway");
  expect(quits).toBe(1);
});

test("quitting from settings with no unsaved edits asks nothing", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  let quits = 0;
  lifecycle.requestQuit(() => {
    quits += 1;
  });
  expect(quits).toBe(1);
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("the Discard dialog's answers answer only it", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(formOf(DARK));
  lifecycle.open(id("attendance"));
  expect(() => {
    lifecycle.answer("keep-open");
  }).toThrow();

  lifecycle.answer("keep-editing");
  lifecycle.open(id("attendance"));
  lifecycle.answer("discard");
  lifecycle.setBusy(id("attendance"), busy("Taking the register"));
  lifecycle.requestClose(id("attendance"));
  expect(() => {
    lifecycle.answer("discard");
  }).toThrow();
});

const IN_CHINESE: HubSettings = {
  ...FIRST_LAUNCH_SETTINGS,
  displayLanguage: { kind: "chosen", language: "zh-HK" },
};

test("a chosen Display Language overrides the OS one, and system follows the OS", () => {
  const chosen = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: IN_CHINESE,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  }).snapshot();
  expect(chosen.displayLanguage).toBe("zh-HK");
  expect(chosen.plugins.map(({ name }) => name)).toEqual([
    "計時器",
    "點名",
    "Seating Plan",
  ]);
  expect(
    createLifecycle({
      hubVersion: HUB_VERSION,
      systemLanguage: "zh-HK",
      installed: plugins,
      storedAtStart: FIRST_LAUNCH_SETTINGS,
      keyedAtStart: new Set(),
      save: ignoreSave,
      unknownTheme: ignoreUnknownTheme,
      assistant: NO_ASSISTANT,
      registry: DEV_MODE,
    }).snapshot().displayLanguage,
  ).toBe("zh-HK");
});

test("saving a Display Language switches the Hub Chrome and re-sorts Plugin names, with no note when no Plugin is open", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(formOf(IN_CHINESE));
  expect(lifecycle.snapshot().displayLanguage).toBe("en-HK");

  lifecycle.saveSettings();
  expect(saved).toEqual([IN_CHINESE]);
  expect(lifecycle.snapshot()).toMatchObject({
    displayLanguage: "zh-HK",
    content: { kind: "settings", languageNoteShowing: false },
  });
  expect(lifecycle.snapshot().plugins.map(({ name }) => name)).toEqual([
    "計時器",
    "點名",
    "Seating Plan",
  ]);
});

test("saving a Display Language with a Plugin open shows the note, until staff leave settings", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.open(id("attendance"));
  lifecycle.showSettings();
  lifecycle.editSettings(formOf(IN_CHINESE));
  lifecycle.saveSettings();
  expect(lifecycle.snapshot().content).toMatchObject({
    languageNoteShowing: true,
  });

  lifecycle.open(id("attendance"));
  lifecycle.showSettings();
  expect(lifecycle.snapshot().content).toMatchObject({
    languageNoteShowing: false,
  });
});

test("the language note goes once the last open Plugin closes while settings show", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.open(id("attendance"));
  lifecycle.open(id("class-timer"));
  lifecycle.showSettings();
  lifecycle.editSettings(formOf(IN_CHINESE));
  lifecycle.saveSettings();

  lifecycle.close(id("class-timer"));
  expect(lifecycle.snapshot().content).toMatchObject({
    kind: "settings",
    languageNoteShowing: true,
  });
  lifecycle.close(id("attendance"));
  expect(lifecycle.snapshot().content).toMatchObject({
    kind: "settings",
    languageNoteShowing: false,
  });
});

test("the system description holds what is stored and drawn, and the installed Plugins in the Switcher's order", () => {
  const stored: HubSettings = {
    ...IN_CHINESE,
    aiProviders: [
      {
        label: parseAiProviderLabel("School Azure"),
        endpoint: {
          kind: "openai-compatible",
          baseUrl: "https://school.openai.azure.com/openai/v1",
        },
        models: [{ id: "gpt-5", acceptsImages: true }],
      },
      {
        label: parseAiProviderLabel("Claude"),
        endpoint: { kind: "anthropic" },
        models: [{ id: "claude-opus-5-5", acceptsImages: true }],
      },
    ],
  };
  const { lifecycle } = inSettings(stored);
  lifecycle.editSettings(
    formOf({
      ...stored,
      colourScheme: "dark",
      aiProviders: [],
      defaultAiProvider: { kind: "none" },
    }),
  );
  const os = { name: "win32", version: "10.0.19045", arch: "x64" };
  expect(lifecycle.systemDescription(os)).toEqual({
    hubVersion: "1.4.2",
    os,
    displayLanguage: "zh-HK",
    theme: "hawkeye",
    colourScheme: "system",
    plugins: [
      { id: "class-timer", version: "1.0.0" },
      { id: "attendance", version: "1.0.0" },
      { id: "seating-plan", version: "1.0.0" },
    ],
    pythonVersions: [],
    aiProviders: [
      { label: "School Azure", kind: "openai-compatible" },
      { label: "Claude", kind: "anthropic" },
    ],
    authProvider: { kind: "none" },
  });
});

test("saving anything but the Display Language with a Plugin open shows no note", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.open(id("attendance"));
  lifecycle.showSettings();
  lifecycle.editSettings(formOf(DARK));
  lifecycle.saveSettings();
  expect(lifecycle.snapshot().content).toMatchObject({
    languageNoteShowing: false,
  });
});

test("choosing the language the OS already gives changes nothing a Plugin sees, so shows no note", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.open(id("attendance"));
  lifecycle.showSettings();
  lifecycle.editSettings(
    formOf({
      ...FIRST_LAUNCH_SETTINGS,
      displayLanguage: { kind: "chosen", language: "en-HK" },
    }),
  );
  lifecycle.saveSettings();
  expect(lifecycle.snapshot().content).toMatchObject({
    languageNoteShowing: false,
  });
});

// The Plugin Catalogue (spec #91, ticket #92).

function offered(
  raw: string,
  name: unknown,
  description: Manifest["description"],
  access: RegistryPlugin["access"],
): RegistryPlugin {
  const { manifest } = installed(raw, name);
  return {
    manifest: { ...manifest, description },
    url: `https://registry.example/${raw}.zip` as RegistryPlugin["url"],
    sha256: "a".repeat(64) as RegistryPlugin["sha256"],
    iconUrl: `https://registry.example/${raw}.svg` as RegistryPlugin["iconUrl"],
    access,
  };
}

const OFFERED = [
  offered(
    "class-timer",
    { "en-HK": "Timer", "zh-HK": "計時器" },
    { "en-HK": "Times a class.", "zh-HK": "為課堂計時。" },
    { kind: "installable" },
  ),
  offered(
    "attendance",
    { "en-HK": "Attendance", "zh-HK": "點名" },
    "Takes the register.",
    { kind: "blocked", reason: "not-for-this-computer" },
  ),
];

/**
 * An installed Hub's Lifecycle, in `language`, how many Registry checks it asked for, and the
 * Plugins it asked to install.
 */
function withRegistry(language: "en-HK" | "zh-HK") {
  const checks = { asked: 0 };
  const installs: string[] = [];
  const uninstalls: string[] = [];
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: language,
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: {
      kind: "on",
      check: () => {
        checks.asked += 1;
      },
      install: (plugin) => {
        installs.push(`${plugin.manifest.id}@${plugin.manifest.version}`);
      },
      uninstall: (plugin, data) => {
        uninstalls.push(`${plugin.manifest.id} ${data}`);
      },
    },
  });
  return { lifecycle, checks, installs, uninstalls };
}

test("an installed Hub's Catalogue is checking until the first check answers", () => {
  expect(withRegistry("en-HK").lifecycle.snapshot().catalogue).toEqual({
    kind: "checking",
  });
});

test("showing the Catalogue puts it in the content area, with open Plugins kept open behind it", () => {
  const { lifecycle } = withRegistry("en-HK");
  lifecycle.open(id("attendance"));

  lifecycle.showCatalogue();
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["attendance"],
    foreground: "attendance",
    content: { kind: "catalogue" },
  });

  lifecycle.open(id("attendance"));
  expect(lifecycle.snapshot().content).toEqual({ kind: "plugin" });
});

test("a check lists each Plugin by name, description and Registry icon in the Display Language, sorted, with its access", () => {
  const { lifecycle } = withRegistry("zh-HK");

  lifecycle.registryChecked({ kind: "listed", plugins: OFFERED });
  expect(lifecycle.snapshot().catalogue).toEqual({
    kind: "listed",
    plugins: [
      {
        id: "class-timer",
        name: "計時器",
        description: "為課堂計時。",
        iconUrl: "hawkeye-icon://class-timer/registry.svg",
        access: { kind: "installable" },
        installed: { kind: "installed", version: "1.0.0" },
        job: { kind: "none" },
      },
      {
        id: "attendance",
        name: "點名",
        description: "Takes the register.",
        iconUrl: "hawkeye-icon://attendance/registry.svg",
        access: { kind: "blocked", reason: "not-for-this-computer" },
        installed: { kind: "installed", version: "1.0.0" },
        job: { kind: "none" },
      },
    ],
  });
});

// Install (ticket #93).

const LIBRARY = offered(
  "library",
  { "en-HK": "Library", "zh-HK": "圖書館" },
  "Lends books.",
  { kind: "installable" },
);

/** The Catalogue entry for `raw`, once a check has listed it. */
function entryOf(lifecycle: Lifecycle, raw: string) {
  const { catalogue } = lifecycle.snapshot();
  if (catalogue.kind !== "listed") throw new Error(catalogue.kind);
  return catalogue.plugins.find((plugin) => plugin.id === raw);
}

test("a Plugin not installed is listed as such, and Install shows it installing and asks main to install it", () => {
  const { lifecycle, installs } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: [LIBRARY] });
  expect(entryOf(lifecycle, "library")).toMatchObject({
    installed: { kind: "not-installed" },
    job: { kind: "none" },
  });
  const seen: string[] = [];
  lifecycle.onChange(() => {
    seen.push(entryOf(lifecycle, "library")?.job.kind ?? "gone");
  });

  lifecycle.install(id("library"));

  expect(entryOf(lifecycle, "library")?.job).toEqual({ kind: "installing" });
  expect(seen).toEqual(["installing"]);
  expect(installs).toEqual(["library@1.0.0"]);
});

test("a finished install puts the Plugin in the Switcher, openable, with its installed version in the Catalogue", () => {
  const { lifecycle } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: [LIBRARY] });
  lifecycle.install(id("library"));
  const library = installed("library", { "en-HK": "Library" });

  lifecycle.installFinished(id("library"), {
    kind: "installed",
    plugin: library,
  });

  expect(lifecycle.snapshot().plugins.map(({ name }) => name)).toEqual([
    "Attendance",
    "Library",
    "Seating Plan",
    "Timer",
  ]);
  expect(entryOf(lifecycle, "library")).toMatchObject({
    installed: { kind: "installed", version: "1.0.0" },
    job: { kind: "none" },
  });
  expect(lifecycle.installed(id("library"))).toBe(library);
  lifecycle.open(id("library"));
  expect(lifecycle.snapshot().foreground).toBe("library");
});

test("a failed install shows its cause, and Install can be tried again", () => {
  const { lifecycle, installs } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: [LIBRARY] });
  lifecycle.install(id("library"));

  lifecycle.installFinished(id("library"), {
    kind: "failed",
    cause: "checksum",
  });
  expect(entryOf(lifecycle, "library")).toMatchObject({
    installed: { kind: "not-installed" },
    job: { kind: "install-failed", cause: "checksum" },
  });
  expect(lifecycle.snapshot().plugins).toHaveLength(3);

  lifecycle.install(id("library"));
  expect(entryOf(lifecycle, "library")?.job).toEqual({ kind: "installing" });
  expect(installs).toEqual(["library@1.0.0", "library@1.0.0"]);
});

test("Install throws for a Plugin that is blocked, installed, installing or not offered", () => {
  const { lifecycle } = withRegistry("en-HK");
  lifecycle.registryChecked({
    kind: "listed",
    plugins: [...OFFERED, LIBRARY],
  });
  lifecycle.install(id("library"));
  for (const raw of ["attendance", "class-timer", "library", "unknown"]) {
    expect(() => {
      lifecycle.install(id(raw));
    }).toThrow();
  }
});

test("an install finishing for a Plugin not installing throws", () => {
  const { lifecycle } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: [LIBRARY] });
  expect(() => {
    lifecycle.installFinished(id("library"), {
      kind: "failed",
      cause: "download",
    });
  }).toThrow();
});

test("a failed check leaves installed Plugins as they are, and the Catalogue unreachable; Retry checks again", () => {
  const { lifecycle, checks } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: OFFERED });
  const before = lifecycle.snapshot();

  lifecycle.registryChecked({
    kind: "failed",
    failure: { kind: "no-response" },
  });
  expect(lifecycle.snapshot()).toEqual({
    ...before,
    catalogue: { kind: "unreachable" },
  });

  lifecycle.retryRegistry();
  expect(lifecycle.snapshot().catalogue).toEqual({ kind: "checking" });
  expect(checks.asked).toBe(1);
});

test("Retry while the Registry is reachable or being checked throws", () => {
  const { lifecycle } = withRegistry("en-HK");
  expect(() => {
    lifecycle.retryRegistry();
  }).toThrow();
  lifecycle.registryChecked({ kind: "listed", plugins: [] });
  expect(() => {
    lifecycle.retryRegistry();
  }).toThrow();
});

test("dev mode has no Catalogue: showing it, retrying or answering a check throws", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: NO_ASSISTANT,
    registry: DEV_MODE,
  });
  expect(lifecycle.snapshot().catalogue).toEqual({ kind: "off" });
  expect(() => {
    lifecycle.showCatalogue();
  }).toThrow();
  expect(() => {
    lifecycle.retryRegistry();
  }).toThrow();
  expect(() => {
    lifecycle.registryChecked({ kind: "listed", plugins: [] });
  }).toThrow();
});

test("settings and the Catalogue replace each other; leaving settings with unsaved edits asks first", () => {
  const { lifecycle } = withRegistry("en-HK");
  lifecycle.showCatalogue();
  lifecycle.showSettings();
  expect(lifecycle.snapshot().content).toMatchObject({ kind: "settings" });
  lifecycle.editSettings(formOf(DARK));

  lifecycle.showCatalogue();
  expect(lifecycle.snapshot()).toMatchObject({
    content: { kind: "settings", form: formOf(DARK) },
    dialog: { kind: "discard-changes" },
  });

  lifecycle.answer("discard");
  expect(lifecycle.snapshot()).toMatchObject({
    content: { kind: "catalogue" },
    dialog: null,
  });
});

// Uninstall (ticket #95).

test("Uninstall asks first, and Keep installed changes nothing", () => {
  const { lifecycle, uninstalls } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: OFFERED });
  const before = lifecycle.snapshot();

  lifecycle.uninstall(id("class-timer"));
  expect(lifecycle.snapshot().dialog).toEqual({
    kind: "uninstall",
    plugin: { id: "class-timer", name: "Timer" },
  });

  lifecycle.answer("keep-installed");
  expect(lifecycle.snapshot()).toEqual(before);
  expect(uninstalls).toEqual([]);
});

test.each([
  ["uninstall", "keep-data"],
  ["uninstall-and-delete-data", "delete-data"],
] as const)(
  "confirming %s on a closed Plugin asks main to uninstall it with %s; once finished it leaves the Switcher",
  (answer, data) => {
    const { lifecycle, uninstalls } = withRegistry("en-HK");
    lifecycle.registryChecked({ kind: "listed", plugins: OFFERED });

    lifecycle.uninstall(id("class-timer"));
    lifecycle.answer(answer);
    expect(lifecycle.snapshot().dialog).toBeNull();
    expect(entryOf(lifecycle, "class-timer")?.job).toEqual({
      kind: "uninstalling",
    });
    expect(uninstalls).toEqual([`class-timer ${data}`]);
    expect(() => {
      lifecycle.open(id("class-timer"));
    }).toThrow();

    lifecycle.uninstallFinished(id("class-timer"));
    expect(lifecycle.snapshot().plugins.map(({ id }) => id)).toEqual([
      "attendance",
      "seating-plan",
    ]);
    expect(entryOf(lifecycle, "class-timer")).toMatchObject({
      installed: { kind: "not-installed" },
      job: { kind: "none" },
    });
    expect(() => lifecycle.installed(id("class-timer"))).toThrow();
  },
);

test("uninstalling an open Plugin closes it first, then asks; main is asked only once it is gone", () => {
  const { lifecycle, uninstalls } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: OFFERED });
  lifecycle.open(id("class-timer"));

  lifecycle.uninstall(id("class-timer"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    closing: ["class-timer"],
    dialog: { kind: "uninstall", plugin: { id: "class-timer", name: "Timer" } },
  });

  lifecycle.answer("uninstall");
  expect(uninstalls).toEqual([]);
  lifecycle.closed(id("class-timer"));
  expect(uninstalls).toEqual(["class-timer keep-data"]);
});

test("Keep installed after the close leaves the Plugin closed and installed", () => {
  const { lifecycle, uninstalls } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: OFFERED });
  lifecycle.open(id("class-timer"));
  lifecycle.uninstall(id("class-timer"));

  lifecycle.answer("keep-installed");
  lifecycle.closed(id("class-timer"));
  expect(lifecycle.snapshot()).toMatchObject({ open: [], dialog: null });
  expect(entryOf(lifecycle, "class-timer")?.job).toEqual({ kind: "none" });
  expect(uninstalls).toEqual([]);
});

test("uninstalling a Busy Plugin asks to close it first; Keep open keeps it open and installed, asking nothing more", () => {
  const { lifecycle, uninstalls } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: OFFERED });
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing a test"));

  lifecycle.uninstall(id("class-timer"));
  expect(lifecycle.snapshot().dialog).toMatchObject({ kind: "busy-close" });

  lifecycle.answer("keep-open");
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    dialog: null,
  });
  expect(entryOf(lifecycle, "class-timer")?.job).toEqual({ kind: "none" });
  lifecycle.close(id("class-timer"));
  expect(lifecycle.snapshot().dialog).toBeNull();
  lifecycle.closed(id("class-timer"));
  expect(uninstalls).toEqual([]);
});

test("uninstalling a Busy Plugin closes it on Close anyway, then asks", () => {
  const { lifecycle, uninstalls } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: OFFERED });
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing a test"));
  lifecycle.uninstall(id("class-timer"));

  lifecycle.answer("close-anyway");
  expect(lifecycle.snapshot()).toMatchObject({
    closing: ["class-timer"],
    dialog: { kind: "uninstall" },
  });
  lifecycle.answer("uninstall-and-delete-data");
  lifecycle.closed(id("class-timer"));
  expect(uninstalls).toEqual(["class-timer delete-data"]);
});

test("Uninstall throws for a Plugin not installed or already uninstalling, and finishing one not uninstalling throws", () => {
  const { lifecycle } = withRegistry("en-HK");
  lifecycle.registryChecked({ kind: "listed", plugins: [LIBRARY] });
  expect(() => {
    lifecycle.uninstall(id("library"));
  }).toThrow();
  expect(() => {
    lifecycle.uninstallFinished(id("class-timer"));
  }).toThrow();
  lifecycle.uninstall(id("class-timer"));
  lifecycle.answer("uninstall");
  expect(() => {
    lifecycle.uninstall(id("class-timer"));
  }).toThrow();
});

// The Assistant Panel (#108).

const helper = installed("regex-helper", "Regex Helper", {
  assistant: {
    kind: "enabled",
    templates: [
      {
        label: { "en-HK": "Draft a regex", "zh-HK": "草擬正則" },
        text: "Draft a regex for …",
      },
    ],
  },
});
const HELPER = id("regex-helper");

/** A chat the test drives: `delta`, `finish` or `fail` it, and see whether it was cancelled. */
function drivenChat() {
  let controller: ReadableStreamDefaultController<string> | undefined;
  const [text, forDone] = new ReadableStream<string>({
    start: (started) => {
      controller = started;
    },
  }).tee();
  if (controller === undefined) throw new Error("start runs at once");
  const stream = controller;
  const done = (async () => {
    let reply = "";
    for await (const delta of forDone) reply += delta;
    return reply;
  })();
  done.catch(() => undefined);
  const driven = {
    cancelled: false,
    delta: (delta: string) => {
      stream.enqueue(delta);
    },
    finish: () => {
      stream.close();
    },
    fail: (failure: AiFailure) => {
      stream.error(new AiCallFailed(failure));
    },
  };
  const chat: AiChat = {
    text,
    done,
    cancel: () => {
      driven.cancelled = true;
      stream.close();
    },
  };
  return { driven, chat };
}

/** A Lifecycle with the Regex Helper (which has an Assistant) and the others, and its chats. */
function withAssistant(
  stored: HubSettings = FIRST_LAUNCH_SETTINGS,
  systemLanguage: "en-HK" | "zh-HK" = "en-HK",
  modelsAtStart: AssistantModels = new Map(),
) {
  const requests: AiChatRequest[] = [];
  const saved: AssistantModels[] = [];
  const chats: ReturnType<typeof drivenChat>["driven"][] = [];
  const read: string[] = [];
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage,
    installed: [helper, ...plugins],
    storedAtStart: stored,
    keyedAtStart: new Set(),
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    assistant: {
      modelsAtStart,
      saveModels: (models) => {
        saved.push(new Map(models));
      },
      context: ({ manifest }, language) => {
        read.push(manifest.id);
        return `Context of ${manifest.id} in ${language}`;
      },
      chat: (request) => {
        requests.push(request);
        const { driven, chat } = drivenChat();
        chats.push(driven);
        return chat;
      },
    },
    registry: DEV_MODE,
  });
  const chat = (at: number) => {
    const driven = chats[at];
    if (driven === undefined) throw new Error(`No chat ${String(at)}`);
    return driven;
  };
  return { lifecycle, requests, chat, read, saved };
}

const said = (text: string) => [{ type: "text" as const, text }];

test("a Plugin without an Assistant has no Panel, and toggling one throws, as for a Plugin not open", () => {
  const { lifecycle } = withAssistant();
  lifecycle.open(id("class-timer"));
  expect(lifecycle.snapshot().assistant).toEqual({ kind: "none" });
  expect(() => {
    lifecycle.toggleAssistant(id("class-timer"));
  }).toThrow();
  expect(() => {
    lifecycle.toggleAssistant(HELPER);
  }).toThrow();
});

test("the Assistant Panel starts closed, toggles, and is remembered per Plugin, across a close", () => {
  const { lifecycle } = withAssistant();
  lifecycle.open(HELPER);
  expect(lifecycle.snapshot().assistant).toEqual({ kind: "closed" });

  lifecycle.toggleAssistant(HELPER);
  expect(lifecycle.snapshot().assistant).toEqual({
    kind: "open",
    conversation: { messages: [], reply: { kind: "idle" } },
    templates: [{ label: "Draft a regex", text: "Draft a regex for …" }],
    model: { choice: { kind: "default" }, kind: "none" },
    providers: [],
  });

  // Another Plugin in front shows its own; bringing the helper back shows it open still.
  lifecycle.open(id("class-timer"));
  expect(lifecycle.snapshot().assistant).toEqual({ kind: "none" });
  lifecycle.open(HELPER);
  expect(lifecycle.snapshot().assistant.kind).toBe("open");

  lifecycle.close(HELPER);
  lifecycle.closed(HELPER);
  lifecycle.open(HELPER);
  expect(lifecycle.snapshot().assistant.kind).toBe("open");
  lifecycle.toggleAssistant(HELPER);
  expect(lifecycle.snapshot().assistant).toEqual({ kind: "closed" });
});

test("the open Panel offers the Plugin's Prompt Templates in the Display Language", () => {
  const { lifecycle } = withAssistant(FIRST_LAUNCH_SETTINGS, "zh-HK");
  lifecycle.open(HELPER);
  lifecycle.toggleAssistant(HELPER);
  expect(lifecycle.snapshot().assistant).toMatchObject({
    templates: [{ label: "草擬正則", text: "Draft a regex for …" }],
  });
});

test("the open Panel's current model is the Default AI Provider's, with whether it accepts images", () => {
  const { lifecycle } = withAssistant(WITH_CLAUDE);
  lifecycle.open(HELPER);
  lifecycle.toggleAssistant(HELPER);
  expect(lifecycle.snapshot().assistant).toMatchObject({
    model: {
      kind: "chosen",
      provider: "Claude",
      model: "claude-opus-5-5",
      acceptsImages: true,
    },
  });
});

test("a message streams a reply from the Default AI Provider, with the context read at open", async () => {
  const { lifecycle, requests, chat, read } = withAssistant();
  lifecycle.open(HELPER);
  expect(read).toEqual(["regex-helper"]);
  lifecycle.toggleAssistant(HELPER);

  lifecycle.sendToAssistant(HELPER, said("Hi"));
  expect(requests).toEqual([
    {
      model: { kind: "default" },
      system: "Context of regex-helper in en-HK",
      messages: [{ role: "user", content: said("Hi") }],
    },
  ]);
  chat(0).delta("Hello");
  chat(0).delta(" there");
  await vi.waitFor(() => {
    expect(lifecycle.snapshot().assistant).toMatchObject({
      conversation: {
        messages: [{ role: "user", content: said("Hi") }],
        reply: { kind: "streaming", text: "Hello there" },
      },
    });
  });
  // One reply at a time.
  expect(() => {
    lifecycle.sendToAssistant(HELPER, said("And?"));
  }).toThrow();

  chat(0).finish();
  await vi.waitFor(() => {
    expect(lifecycle.snapshot().assistant).toMatchObject({
      conversation: {
        messages: [
          { role: "user", content: said("Hi") },
          { role: "assistant", content: said("Hello there") },
        ],
        reply: { kind: "idle" },
      },
    });
  });

  // The next message carries the conversation so far; the context is not read again.
  lifecycle.sendToAssistant(HELPER, said("Thanks"));
  expect(requests[1]?.messages).toHaveLength(3);
  expect(read).toEqual(["regex-helper"]);
});

test("Stop keeps what had arrived, and New conversation starts again", async () => {
  const { lifecycle, chat } = withAssistant();
  lifecycle.open(HELPER);
  lifecycle.toggleAssistant(HELPER);
  lifecycle.sendToAssistant(HELPER, said("Hi"));
  chat(0).delta("Partial");
  await vi.waitFor(() => {
    expect(lifecycle.snapshot().assistant).toMatchObject({
      conversation: { reply: { kind: "streaming", text: "Partial" } },
    });
  });

  lifecycle.stopAssistant(HELPER);
  expect(chat(0).cancelled).toBe(true);
  await vi.waitFor(() => {
    expect(lifecycle.snapshot().assistant).toMatchObject({
      conversation: {
        messages: [
          { role: "user", content: said("Hi") },
          { role: "assistant", content: said("Partial") },
        ],
        reply: { kind: "idle" },
      },
    });
  });
  // Stopping with nothing streaming does nothing: staff may click as the reply ends.
  lifecycle.stopAssistant(HELPER);

  lifecycle.sendToAssistant(HELPER, said("Again"));
  lifecycle.newConversation(HELPER);
  expect(chat(1).cancelled).toBe(true);
  expect(lifecycle.snapshot().assistant).toMatchObject({
    conversation: { messages: [], reply: { kind: "idle" } },
  });
});

test("a failed reply shows its failure until the next message", async () => {
  const { lifecycle, chat } = withAssistant();
  lifecycle.open(HELPER);
  lifecycle.toggleAssistant(HELPER);
  lifecycle.sendToAssistant(HELPER, said("Hi"));
  chat(0).fail({ code: "provider-rejected", status: 401 });
  await vi.waitFor(() => {
    expect(lifecycle.snapshot().assistant).toMatchObject({
      conversation: {
        messages: [{ role: "user", content: said("Hi") }],
        reply: {
          kind: "failed",
          failure: { code: "provider-rejected", status: 401 },
        },
      },
    });
  });
  lifecycle.sendToAssistant(HELPER, said("Hi"));
  expect(lifecycle.snapshot().assistant).toMatchObject({
    conversation: { reply: { kind: "streaming", text: "" } },
  });
});

test("closing the Plugin cancels its reply and drops its conversation", async () => {
  const { lifecycle, chat } = withAssistant();
  lifecycle.open(HELPER);
  lifecycle.toggleAssistant(HELPER);
  lifecycle.sendToAssistant(HELPER, said("Hi"));
  chat(0).delta("Partial");

  lifecycle.close(HELPER);
  expect(chat(0).cancelled).toBe(true);
  expect(() => {
    lifecycle.sendToAssistant(HELPER, said("Hi"));
  }).toThrow();
  lifecycle.closed(HELPER);
  lifecycle.open(HELPER);
  // Let the cancelled chat end: nothing of it comes back.
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(lifecycle.snapshot().assistant).toMatchObject({
    conversation: { messages: [], reply: { kind: "idle" } },
  });
});

test("the model picker saves its choice at once, for its Plugin only, and later messages use it", () => {
  const local = parseAiProviderLabel("Local");
  const big = { kind: "chosen" as const, provider: local, model: "big-model" };
  const other = id("other-helper");
  const stored: HubSettings = {
    ...FIRST_LAUNCH_SETTINGS,
    aiProviders: [
      {
        label: local,
        endpoint: { kind: "openai-compatible", baseUrl: "http://localhost:1" },
        models: [{ id: "big-model", acceptsImages: true }],
      },
    ],
  };
  const { lifecycle, requests, saved } = withAssistant(
    stored,
    "en-HK",
    new Map([[other, big]]),
  );
  lifecycle.open(HELPER);
  lifecycle.toggleAssistant(HELPER);
  expect(lifecycle.snapshot().assistant).toMatchObject({
    model: { choice: { kind: "default" }, kind: "none" },
    providers: [
      {
        label: "Local",
        models: [{ id: "big-model", acceptsImages: true }],
      },
    ],
  });

  lifecycle.chooseModel(HELPER, big);
  expect(saved).toEqual([
    new Map([
      [other, big],
      [HELPER, big],
    ]),
  ]);
  expect(lifecycle.snapshot().assistant).toMatchObject({
    model: {
      choice: big,
      kind: "chosen",
      provider: "Local",
      model: "big-model",
      acceptsImages: true,
    },
  });
  lifecycle.sendToAssistant(HELPER, said("Hi"));
  expect(requests[0]?.model).toEqual(big);

  // After a restart, the saved choice is the Plugin's.
  const restarted = withAssistant(stored, "en-HK", new Map(saved[0]));
  restarted.lifecycle.open(HELPER);
  restarted.lifecycle.sendToAssistant(HELPER, said("Hi"));
  expect(restarted.requests[0]?.model).toEqual(big);
});

test("a chosen provider or model since removed is missing: it offers no images, and its chats fail", () => {
  const gone = {
    kind: "chosen" as const,
    provider: parseAiProviderLabel("Gone"),
    model: "x",
  };
  const { lifecycle, requests } = withAssistant(
    WITH_CLAUDE,
    "en-HK",
    new Map([[HELPER, gone]]),
  );
  lifecycle.open(HELPER);
  lifecycle.toggleAssistant(HELPER);
  expect(lifecycle.snapshot().assistant).toMatchObject({
    model: { choice: gone, kind: "missing" },
  });
  // The call module answers `provider-missing`: the choice goes to it as is, never the Default.
  lifecycle.sendToAssistant(HELPER, said("Hi"));
  expect(requests[0]?.model).toEqual(gone);
});

test("choosing a model needs the Plugin open with an Assistant", () => {
  const { lifecycle } = withAssistant();
  lifecycle.open(id("class-timer"));
  expect(() => {
    lifecycle.chooseModel(id("class-timer"), { kind: "default" });
  }).toThrow();
});
