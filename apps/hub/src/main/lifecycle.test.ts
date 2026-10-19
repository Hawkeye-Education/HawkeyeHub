import { parseManifest, type Manifest } from "@hawkeye-hub/plugin-format";
import { expect, test } from "vitest";
import { parseAbsolutePath, parseHubApiVersion } from "./ids";
import { accessOf, createLifecycle, type Lifecycle } from "./lifecycle";

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

const plugins = [
  installed("class-timer", { "en-HK": "Timer", "zh-HK": "計時器" }),
  installed("attendance", { "en-HK": "Attendance", "zh-HK": "點名" }),
  installed("seating-plan", "Seating Plan"),
];

test("the snapshot lists every installed Plugin by its en-HK name and icon URL, sorted", () => {
  expect(createLifecycle("en-HK", plugins).snapshot()).toEqual({
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
    dialog: null,
  });
});

test("in zh-HK the snapshot uses zh-HK names, falls back to English, and sorts by them", () => {
  expect(
    createLifecycle("zh-HK", plugins)
      .snapshot()
      .plugins.map(({ name }) => name),
    // ICU's zh-HK collation: Han by stroke count (計 9, 點 17), then Latin.
  ).toEqual(["計時器", "點名", "Seating Plan"]);
});

function openAndForeground(lifecycle: Lifecycle) {
  const { open, foreground } = lifecycle.snapshot();
  return { open, foreground };
}

test("opening Plugins brings each forward, and opening an open one brings it forward without a second copy", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  expect(openAndForeground(lifecycle)).toEqual({ open: [], foreground: null });

  lifecycle.open("class-timer");
  lifecycle.open("attendance");
  expect(openAndForeground(lifecycle)).toEqual({
    open: ["attendance", "class-timer"],
    foreground: "attendance",
  });

  lifecycle.open("class-timer");
  expect(openAndForeground(lifecycle)).toEqual({
    open: ["class-timer", "attendance"],
    foreground: "class-timer",
  });
});

test("closing the foreground Plugin brings forward the most recently foregrounded one, then nothing", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.open("seating-plan");
  lifecycle.open("attendance");
  lifecycle.open("class-timer");

  lifecycle.close("class-timer");
  expect(lifecycle.snapshot().foreground).toBe("attendance");
  lifecycle.close("attendance");
  expect(lifecycle.snapshot().foreground).toBe("seating-plan");
  lifecycle.close("seating-plan");
  expect(openAndForeground(lifecycle)).toEqual({ open: [], foreground: null });
});

test("closing a background Plugin leaves the foreground one in front", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.open("attendance");

  lifecycle.close("class-timer");
  expect(openAndForeground(lifecycle)).toEqual({
    open: ["attendance"],
    foreground: "attendance",
  });
});

test("every change is announced", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  const seen: (string | null)[] = [];
  lifecycle.onChange(() => {
    seen.push(lifecycle.snapshot().foreground);
  });

  lifecycle.open("class-timer");
  lifecycle.open("attendance");
  lifecycle.close("attendance");

  expect(seen).toEqual(["class-timer", "attendance", "class-timer"]);
});

test("a closed Plugin is closing until its close finishes, cannot be reopened until then, and then reopens", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.open("attendance");

  lifecycle.close("attendance");
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    closing: ["attendance"],
    foreground: "class-timer",
  });
  expect(() => {
    lifecycle.open("attendance");
  }).toThrow();

  lifecycle.closed("attendance");
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    closing: [],
  });
  lifecycle.open("attendance");
  expect(lifecycle.snapshot().foreground).toBe("attendance");
});

test("finishing the close of a Plugin that is not closing throws", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("attendance");
  expect(() => {
    lifecycle.closed("attendance");
  }).toThrow();
});

test("a staff close of a Plugin that is not Busy closes it without asking", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("attendance");

  lifecycle.requestClose("attendance");
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    closing: ["attendance"],
    dialog: null,
  });
});

test("a staff close of a Busy Plugin asks with its latest reason; Keep open leaves it open", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.setBusy("class-timer", "Timing a test");
  lifecycle.setBusy("class-timer", "Timing an exam");

  lifecycle.requestClose("class-timer");
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    dialog: {
      kind: "busy-close",
      id: "class-timer",
      plugin: { name: "Timer", reason: "Timing an exam" },
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
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.setBusy("class-timer", "Timing an exam");
  lifecycle.requestClose("class-timer");

  lifecycle.answer("close-anyway");
  expect(lifecycle.snapshot()).toMatchObject({
    open: [],
    closing: ["class-timer"],
    dialog: null,
  });

  lifecycle.closed("class-timer");
  lifecycle.open("class-timer");
  lifecycle.requestClose("class-timer");
  expect(lifecycle.snapshot()).toMatchObject({ open: [], dialog: null });
});

test("a Plugin that clears Busy closes without asking, but a dialog already up stays", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.open("attendance");
  lifecycle.setBusy("class-timer", "Timing an exam");
  lifecycle.setBusy("attendance", "Taking the register");
  lifecycle.setBusy("attendance", null);
  lifecycle.requestClose("attendance");
  expect(lifecycle.snapshot()).toMatchObject({
    open: ["class-timer"],
    dialog: null,
  });

  lifecycle.requestClose("class-timer");
  lifecycle.setBusy("class-timer", null);
  expect(lifecycle.snapshot().dialog).toMatchObject({
    kind: "busy-close",
    plugin: { reason: "Timing an exam" },
  });
});

test("a Busy Plugin that closes abnormally while its dialog is up takes the dialog with it", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.setBusy("class-timer", "Timing an exam");
  lifecycle.requestClose("class-timer");

  lifecycle.close("class-timer");
  expect(lifecycle.snapshot()).toMatchObject({
    closing: ["class-timer"],
    dialog: null,
  });
});

test("Busy from a Plugin that is not open is ignored: it arrived as the Plugin closed", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.close("class-timer");
  lifecycle.setBusy("class-timer", "Timing an exam");
  lifecycle.closed("class-timer");

  lifecycle.open("class-timer");
  lifecycle.requestClose("class-timer");
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("a quit with no Busy Plugin goes ahead without asking", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  let quits = 0;

  lifecycle.requestQuit(() => {
    quits += 1;
  });
  expect(quits).toBe(1);
  expect(lifecycle.snapshot().dialog).toBeNull();
});

test("a quit with Busy Plugins asks once, listing each by name; Keep open stays, Quit anyway quits", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.open("attendance");
  lifecycle.open("seating-plan");
  lifecycle.setBusy("class-timer", "Timing an exam");
  lifecycle.setBusy("attendance", "Taking the register");
  let quits = 0;
  const quit = () => {
    quits += 1;
  };

  lifecycle.requestQuit(quit);
  expect(lifecycle.snapshot().dialog).toEqual({
    kind: "busy-quit",
    plugins: [
      { name: "Attendance", reason: "Taking the register" },
      { name: "Timer", reason: "Timing an exam" },
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
  const lifecycle = createLifecycle("en-HK", plugins);
  lifecycle.open("class-timer");
  lifecycle.setBusy("class-timer", "Timing an exam");
  lifecycle.requestClose("class-timer");

  lifecycle.requestQuit(() => undefined);
  expect(lifecycle.snapshot().dialog).toMatchObject({ kind: "busy-quit" });
});

test("an answer that is not one of the pending dialog's buttons, or with no dialog, throws", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  expect(() => {
    lifecycle.answer("keep-open");
  }).toThrow();
  lifecycle.open("class-timer");
  lifecycle.setBusy("class-timer", "Timing an exam");
  lifecycle.requestClose("class-timer");
  expect(() => {
    lifecycle.answer("quit-anyway");
  }).toThrow();
});

test("opening a Plugin that is not installed, or closing one that is not open, throws", () => {
  const lifecycle = createLifecycle("en-HK", plugins);
  expect(() => {
    lifecycle.open("not-installed");
  }).toThrow();
  expect(() => {
    lifecycle.close("attendance");
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
  const lifecycle = createLifecycle("en-HK", [
    installed("sign-in", "Sign In", {
      identity: { kind: "required", roles: [] },
    }),
    installed("future", "Future", { hubApi: "^99.0.0" }),
  ]);
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
    lifecycle.open("sign-in");
  }).toThrow();
  expect(() => {
    lifecycle.open("future");
  }).toThrow();
  expect(lifecycle.snapshot().open).toEqual([]);
});
