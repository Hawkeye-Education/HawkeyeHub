import {
  parseManifest,
  PluginId,
  type Manifest,
} from "@hawkeye-hub/plugin-format";
import { expect, test } from "vitest";
import { parseAbsolutePath, parseHubApiVersion, parseHubVersion } from "./ids";
import type { BusyReason, HubSettings } from "../shared/hub-chrome-ipc";
import { FIRST_LAUNCH_SETTINGS } from "./hub-settings";
import {
  accessOf,
  createLifecycle,
  type Busy,
  type Lifecycle,
} from "./lifecycle";

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
const HUB_VERSION = parseHubVersion("1.4.2");
const ignoreSave = (): void => {
  // Most tests never save.
};

const plugins = [
  installed("class-timer", { "en-HK": "Timer", "zh-HK": "計時器" }),
  installed("attendance", { "en-HK": "Attendance", "zh-HK": "點名" }),
  installed("seating-plan", "Seating Plan"),
];

test("the snapshot lists every installed Plugin by its en-HK name and icon URL, sorted", () => {
  expect(
    createLifecycle(
      HUB_VERSION,
      "en-HK",
      plugins,
      FIRST_LAUNCH_SETTINGS,
      ignoreSave,
    ).snapshot(),
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
  });
});

test("in zh-HK the snapshot uses zh-HK names, falls back to English, and sorts by them", () => {
  expect(
    createLifecycle(
      HUB_VERSION,
      "zh-HK",
      plugins,
      FIRST_LAUNCH_SETTINGS,
      ignoreSave,
    )
      .snapshot()
      .plugins.map(({ name }) => name),
    // ICU's zh-HK collation: Han by stroke count (計 9, 點 17), then Latin.
  ).toEqual(["計時器", "點名", "Seating Plan"]);
});

test("showing settings keeps open Plugins open with the front one still in front, and lists no new Plugin", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
      stored: FIRST_LAUNCH_SETTINGS,
      form: FIRST_LAUNCH_SETTINGS,
    },
  });
  expect(seen).toEqual(["settings"]);
});

const DARK: HubSettings = { ...FIRST_LAUNCH_SETTINGS, colourScheme: "dark" };
const LIGHT: HubSettings = { ...FIRST_LAUNCH_SETTINGS, colourScheme: "light" };

/** A Lifecycle showing settings, starting from `stored`, and the settings each Save saved. */
function inSettings(stored: HubSettings) {
  const saved: HubSettings[] = [];
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    stored,
    (settings) => {
      saved.push(settings);
    },
  );
  lifecycle.showSettings();
  return { lifecycle, saved };
}

test("settings show what is stored", () => {
  const { lifecycle } = inSettings(DARK);
  expect(lifecycle.snapshot().content).toEqual({
    kind: "settings",
    stored: DARK,
    form: DARK,
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
    stored: FIRST_LAUNCH_SETTINGS,
    form: DARK,
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
    stored: DARK,
    form: DARK,
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
    stored: DARK,
    form: DARK,
  });
  expect(saved).toEqual([]);
});

test("a fresh snapshot, as a reloaded Hub Chrome fetches, still holds the unsaved form", () => {
  const { lifecycle } = inSettings(FIRST_LAUNCH_SETTINGS);
  lifecycle.editSettings(LIGHT);
  expect(lifecycle.snapshot().content).toMatchObject({ form: LIGHT });
});

test("picking a Plugin while settings show leaves them and brings that Plugin forward", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
  lifecycle.open(id("attendance"));
  lifecycle.showSettings();

  lifecycle.close(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    foreground: null,
    content: { kind: "settings" },
  });
});

test("editing, saving or cancelling while settings are not showing throws", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
  lifecycle.open(id("class-timer"));
  lifecycle.open(id("attendance"));

  lifecycle.close(id("class-timer"));
  expect(openAndForeground(lifecycle)).toEqual({
    open: ["attendance"],
    foreground: "attendance",
  });
});

test("every change is announced", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
  lifecycle.open(id("attendance"));
  expect(() => {
    lifecycle.closed(id("attendance"));
  }).toThrow();
});

test("a staff close of a Plugin that is not Busy closes it without asking", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
  lifecycle.open(id("attendance"));

  lifecycle.requestClose(id("attendance"));
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    closing: ["attendance"],
    dialog: null,
  });
});

test("a staff close of a Busy Plugin asks with its latest reason; Keep open leaves it open", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing a test"));
  lifecycle.requestQuit(() => undefined);

  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  expect(lifecycle.snapshot().dialog).toMatchObject({
    plugins: [{ reason: "Timing a test" }],
  });
});

test("Busy from a Plugin that is not open is ignored: it arrived as the Plugin closed", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
  lifecycle.open(id("class-timer"));
  lifecycle.close(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.closed(id("class-timer"));

  lifecycle.open(id("class-timer"));
  lifecycle.requestClose(id("class-timer"));
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("a quit with no Busy Plugin goes ahead without asking", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
  lifecycle.open(id("class-timer"));
  let quits = 0;

  lifecycle.requestQuit(() => {
    quits += 1;
  });
  expect(quits).toBe(1);
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("a quit with Busy Plugins asks once, listing each by name; Keep open stays, Quit anyway quits", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
  lifecycle.open(id("class-timer"));
  lifecycle.setBusy(id("class-timer"), busy("Timing an exam"));
  lifecycle.requestClose(id("class-timer"));

  lifecycle.requestQuit(() => undefined);
  expect(lifecycle.snapshot().dialog).toMatchObject({ kind: "busy-quit" });
});

test("an answer that is not one of the pending dialog's buttons, or with no dialog, throws", () => {
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    [
      installed("sign-in", "Sign In", {
        identity: { kind: "required", roles: [] },
      }),
      installed("future", "Future", { hubApi: "^99.0.0" }),
    ],
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
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
  const lifecycle = createLifecycle(
    HUB_VERSION,
    "en-HK",
    plugins,
    FIRST_LAUNCH_SETTINGS,
    ignoreSave,
  );
  expect(lifecycle.installed(id("attendance"))).toBe(plugins[1]);
  expect(() => lifecycle.installed(id("not-installed"))).toThrow();
});
