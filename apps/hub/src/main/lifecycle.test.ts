import {
  parseManifest,
  PluginId,
  type Manifest,
} from "@hawkeye-hub/plugin-format";
import { expect, test } from "vitest";
import { parseAbsolutePath, parseHubApiVersion, parseHubVersion } from "./ids";
import type {
  BusyReason,
  HubSettings,
  ThemeName,
} from "../shared/hub-chrome-ipc";
import {
  BUILT_IN_COMPANY_CONFIGURATION,
  type ClientId,
  type CompanyConfiguration,
} from "./company-config";
import { FIRST_LAUNCH_SETTINGS } from "./hub-settings";
import {
  accessOf,
  createLifecycle,
  HAWKEYE,
  type Busy,
  type Lifecycle,
  type LifecycleDeps,
} from "./lifecycle";
import type { RegistryPlugin, WebUrl } from "./registry";

function installed(
  id: string,
  name: unknown,
  overrides: { hubApi?: string; identity?: unknown } = {},
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
const ignoreSave = (): void => {
  // Most tests never save.
};
const ignoreUnknownTheme = (): void => {
  // Most tests store only Themes this Hub has.
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
      companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
      save: ignoreSave,
      unknownTheme: ignoreUnknownTheme,
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
  });
});

test("in zh-HK the snapshot uses zh-HK names, falls back to English, and sorts by them", () => {
  expect(
    createLifecycle({
      hubVersion: HUB_VERSION,
      systemLanguage: "zh-HK",
      installed: plugins,
      storedAtStart: FIRST_LAUNCH_SETTINGS,
      companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
      save: ignoreSave,
      unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
      form: FIRST_LAUNCH_SETTINGS,
      languageNoteShowing: false,
    },
  });
  expect(seen).toEqual(["settings"]);
});

const DARK: HubSettings = { ...FIRST_LAUNCH_SETTINGS, colourScheme: "dark" };
const LIGHT: HubSettings = { ...FIRST_LAUNCH_SETTINGS, colourScheme: "light" };

/** A Lifecycle showing settings, starting from `stored`, and the settings each Save saved. */
function inSettings(
  stored: HubSettings,
  company: CompanyConfiguration = BUILT_IN_COMPANY_CONFIGURATION,
) {
  const saved: HubSettings[] = [];
  const unknownThemes: string[] = [];
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: stored,
    companyAtStart: company,
    save: (settings) => {
      saved.push(settings);
    },
    unknownTheme: (name) => {
      unknownThemes.push(name);
    },
    registry: DEV_MODE,
  });
  lifecycle.showSettings();
  return { lifecycle, saved, unknownThemes };
}

const themeNamed = (name: string): HubSettings["theme"] => ({
  kind: "chosen",
  name: name as ThemeName,
});

test("on first launch the company's Theme is the Theme", () => {
  const { lifecycle, unknownThemes } = inSettings(FIRST_LAUNCH_SETTINGS);
  expect(lifecycle.snapshot()).toMatchObject({
    theme: "hawkeye",
    themes: ["hawkeye"],
  });
  expect(lifecycle.storedSettings().theme).toEqual({ kind: "company" });
  expect(unknownThemes).toEqual([]);
});

const companyWith = (theme: string): CompanyConfiguration => ({
  ...BUILT_IN_COMPANY_CONFIGURATION,
  theme: theme as ThemeName,
});

test("a company Theme this Hub does not have draws Hawkeye, and is reported once", () => {
  const { lifecycle, unknownThemes } = inSettings(
    FIRST_LAUNCH_SETTINGS,
    companyWith("aurora"),
  );
  expect(lifecycle.snapshot().theme).toBe("hawkeye");
  lifecycle.editSettings(DARK);
  lifecycle.saveSettings();
  expect(unknownThemes).toEqual(["aurora"]);
});

test("a chosen Theme is not the company's", () => {
  const { unknownThemes } = inSettings(
    { ...FIRST_LAUNCH_SETTINGS, theme: themeNamed("hawkeye") },
    companyWith("aurora"),
  );
  expect(unknownThemes).toEqual([]);
});

test("a Company Configuration arriving after the window is drawn pushes a new snapshot with its Theme", () => {
  const { lifecycle, unknownThemes } = inSettings(FIRST_LAUNCH_SETTINGS);
  let pushed = 0;
  lifecycle.onChange(() => {
    pushed += 1;
  });
  lifecycle.companyConfigured(companyWith("harbour"));
  expect(pushed).toBe(1);
  expect(unknownThemes).toEqual(["harbour"]);
  expect(lifecycle.snapshot().theme).toBe("hawkeye");

  lifecycle.companyConfigured(companyWith("hawkeye"));
  expect(pushed).toBe(2);
  expect(unknownThemes).toEqual(["harbour"]);
});

test("the system description reports the Company Configuration's Auth Provider, never signed in yet", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  const os = { name: "win32", version: "10.0.19045", arch: "x64" };
  expect(lifecycle.systemDescription(os).authProvider).toEqual({
    kind: "none",
  });
  lifecycle.companyConfigured({
    theme: HAWKEYE,
    authProvider: {
      kind: "oidc",
      issuer: "https://sso.hawkeye.example/realms/staff" as WebUrl,
      clientId: "hawkeye-hub" as ClientId,
      signInLifetime: { hours: 168 },
    },
    roleMapping: [],
  });
  expect(lifecycle.systemDescription(os).authProvider).toEqual({
    kind: "oidc",
    signedIn: false,
  });
});

test("saving a chosen Theme stores it by name and makes it the Theme", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  const chosen = { ...FIRST_LAUNCH_SETTINGS, theme: themeNamed("hawkeye") };
  lifecycle.editSettings(chosen);
  lifecycle.saveSettings();
  expect(saved).toEqual([chosen]);
  expect(lifecycle.snapshot().theme).toBe("hawkeye");
  expect(lifecycle.storedSettings().theme).toEqual(themeNamed("hawkeye"));
});

test("a stored Theme this Hub does not have resolves to Hawkeye, is reported once, and stays stored", () => {
  const stored = { ...FIRST_LAUNCH_SETTINGS, theme: themeNamed("aurora") };
  const { lifecycle, saved, unknownThemes } = inSettings(stored);
  expect(lifecycle.snapshot().theme).toBe("hawkeye");

  lifecycle.editSettings({ ...stored, colourScheme: "dark" });
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
    form: DARK,
    languageNoteShowing: false,
  });
});

test("editing the form changes only the form, and saves nothing", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  const seen: unknown[] = [];
  lifecycle.onChange(() => {
    seen.push(lifecycle.snapshot().content);
  });

  lifecycle.editSettings(DARK);
  const edited = {
    kind: "settings",
    form: DARK,
    languageNoteShowing: false,
  };
  expect(lifecycle.snapshot().content).toEqual(edited);
  expect(seen).toEqual([edited]);
  expect(saved).toEqual([]);
});

test("Save saves the form once and makes it what is stored", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(DARK);

  lifecycle.saveSettings();
  expect(saved).toEqual([DARK]);
  expect(lifecycle.snapshot().content).toEqual({
    kind: "settings",
    form: DARK,
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
  lifecycle.editSettings(LIGHT);
  lifecycle.editSettings({ ...DARK });
  lifecycle.saveSettings();

  expect(saved).toEqual([]);
  expect(lifecycle.snapshot()).toEqual(before);
});

test("Cancel puts the form back to what is stored and stays in settings", () => {
  const { lifecycle, saved } = inSettings(DARK);
  lifecycle.editSettings(LIGHT);

  lifecycle.cancelSettings();
  expect(lifecycle.snapshot().content).toEqual({
    kind: "settings",
    form: DARK,
    languageNoteShowing: false,
  });
  expect(saved).toEqual([]);
});

test("a fresh snapshot, as a reloaded Hub Chrome fetches, still holds the unsaved form", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(LIGHT);
  expect(lifecycle.snapshot().content).toMatchObject({ form: LIGHT });
});

test("picking a Plugin while settings show leaves them and brings that Plugin forward", () => {
  const lifecycle = createLifecycle({
    hubVersion: HUB_VERSION,
    systemLanguage: "en-HK",
    installed: plugins,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    registry: DEV_MODE,
  });
  expect(() => {
    lifecycle.editSettings(DARK);
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    registry: DEV_MODE,
  });
  expect(lifecycle.installed(id("attendance"))).toBe(plugins[1]);
  expect(() => lifecycle.installed(id("not-installed"))).toThrow();
});

test("picking a Plugin with unsaved edits asks first; Keep editing stays with the edits", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(DARK);

  lifecycle.open(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    content: { kind: "settings", form: DARK },
    dialog: { kind: "discard-changes" },
  });

  lifecycle.answer("keep-editing");
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    content: { kind: "settings", form: DARK },
    dialog: null,
  });
});

test("Discard drops the edits and opens the Plugin that was picked", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(DARK);
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
    form: FIRST_LAUNCH_SETTINGS,
  });
  expect(saved).toEqual([]);
});

test("picking a Plugin after edits that were undone or saved asks nothing", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(DARK);
  lifecycle.editSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.open(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["attendance"],
    dialog: null,
  });

  lifecycle.showSettings();
  lifecycle.editSettings(DARK);
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
    registry: DEV_MODE,
  });
  lifecycle.showSettings();
  lifecycle.editSettings(DARK);
  expect(() => {
    lifecycle.open(id("future"));
  }).toThrow();
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("quitting with unsaved edits asks first; Keep editing stays, Discard quits when nothing is Busy", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(DARK);
  let quits = 0;
  const quit = () => {
    quits += 1;
  };

  lifecycle.requestQuit(quit);
  expect(lifecycle.snapshot().dialog).toEqual({ kind: "discard-changes" });
  lifecycle.answer("keep-editing");
  expect(quits).toBe(0);
  expect(lifecycle.snapshot()).toMatchObject({
    content: { kind: "settings", form: DARK },
    dialog: null,
  });

  lifecycle.requestQuit(quit);
  lifecycle.answer("discard");
  expect(quits).toBe(1);
  expect(lifecycle.snapshot()).toMatchObject({
    content: { form: FIRST_LAUNCH_SETTINGS },
    dialog: null,
  });
  expect(saved).toEqual([]);
});

test("Discard on quit goes on to the Busy dialog when a Plugin is Busy", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.showSettings();
  lifecycle.editSettings(DARK);
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
  lifecycle.editSettings(DARK);
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
      companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
      save: ignoreSave,
      unknownTheme: ignoreUnknownTheme,
      registry: DEV_MODE,
    }).snapshot().displayLanguage,
  ).toBe("zh-HK");
});

test("saving a Display Language switches the Hub Chrome and re-sorts Plugin names, with no note when no Plugin is open", () => {
  const { lifecycle, saved } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(IN_CHINESE);
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
  lifecycle.editSettings(IN_CHINESE);
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
  lifecycle.editSettings(IN_CHINESE);
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
  const { lifecycle } = inSettings(IN_CHINESE);
  lifecycle.editSettings({ ...IN_CHINESE, colourScheme: "dark" });
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
    aiProviders: [],
    authProvider: { kind: "none" },
  });
});

test("saving anything but the Display Language with a Plugin open shows no note", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.open(id("attendance"));
  lifecycle.showSettings();
  lifecycle.editSettings(DARK);
  lifecycle.saveSettings();
  expect(lifecycle.snapshot().content).toMatchObject({
    languageNoteShowing: false,
  });
});

test("choosing the language the OS already gives changes nothing a Plugin sees, so shows no note", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.open(id("attendance"));
  lifecycle.showSettings();
  lifecycle.editSettings({
    ...FIRST_LAUNCH_SETTINGS,
    displayLanguage: { kind: "chosen", language: "en-HK" },
  });
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
    companyAtStart: BUILT_IN_COMPANY_CONFIGURATION,
    save: ignoreSave,
    unknownTheme: ignoreUnknownTheme,
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
  lifecycle.editSettings(DARK);

  lifecycle.showCatalogue();
  expect(lifecycle.snapshot()).toMatchObject({
    content: { kind: "settings", form: DARK },
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
