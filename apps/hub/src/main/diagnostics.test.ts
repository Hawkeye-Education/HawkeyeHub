import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, expect, test } from "vitest";
import {
  openDiagnostics,
  type HubEvent,
  type PluginCrash,
  type SystemDescription,
} from "./diagnostics";
import {
  parseAbsolutePath,
  parseAiProviderKind,
  parseAiProviderLabel,
  parseHubVersion,
  parsePluginId,
  parsePluginVersion,
  parsePythonVersion,
  parseRpcErrorReason,
  type AbsolutePath,
} from "./ids";

const NOW = new Date("2026-03-04T05:06:07.890Z");
const plugin = {
  id: parsePluginId("marking-assistant"),
  version: parsePluginVersion("1.2.3"),
};
let logsDir: AbsolutePath;

beforeEach(() => {
  logsDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-diagnostics-")));
});

/** A destination path in a fresh temp folder, and that folder. */
function exportTarget(): { folder: string; destination: AbsolutePath } {
  const folder = mkdtempSync(join(tmpdir(), "hub-export-"));
  return { folder, destination: parseAbsolutePath(join(folder, "b.zip")) };
}

function readLines(relativePath: string): unknown[] {
  return readFileSync(join(logsDir, relativePath), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));
}

function hubLine(level: string, message: string) {
  return {
    time: "2026-03-04T05:06:07.890Z",
    source: "hub",
    level,
    pluginId: null,
    pluginVersion: null,
    message,
  };
}

function pluginLine(level: string, message: string) {
  return {
    ...hubLine(level, message),
    pluginId: "marking-assistant",
    pluginVersion: "1.2.3",
  };
}

const uncaught = new Error("boom");
uncaught.stack = "Error: boom\n    at main.ts:1:1";

const cases: [string, HubEvent, unknown][] = [
  ["Hub opened", { kind: "hub-opened" }, hubLine("info", "Hub opened")],
  ["Hub closing", { kind: "hub-closing" }, hubLine("info", "Hub closing")],
  [
    "Plugin installed",
    { kind: "plugin-installed", plugin },
    pluginLine("info", "Plugin installed"),
  ],
  [
    "Plugin updated",
    {
      kind: "plugin-updated",
      plugin,
      previousVersion: parsePluginVersion("1.1.0"),
    },
    pluginLine("info", "Plugin updated from 1.1.0"),
  ],
  [
    "Plugin uninstalled",
    { kind: "plugin-uninstalled", plugin },
    pluginLine("info", "Plugin uninstalled"),
  ],
  [
    "signed in",
    { kind: "sign-in", result: { signedIn: true } },
    hubLine("info", "Signed in"),
  ],
  [
    "sign-in failed",
    {
      kind: "sign-in",
      result: { signedIn: false, failure: "provider-unreachable" },
    },
    hubLine("warn", "Sign-in failed: provider unreachable"),
  ],
  [
    "Plugin left out: folder missing",
    { kind: "plugin-left-out", plugin, reason: "folder-missing" },
    pluginLine("warn", "Plugin left out: folder missing"),
  ],
  [
    "Plugin left out: Manifest invalid",
    { kind: "plugin-left-out", plugin, reason: "manifest-invalid" },
    pluginLine("warn", "Plugin left out: Manifest invalid"),
  ],
  [
    "Plugin left out: Manifest disagrees",
    { kind: "plugin-left-out", plugin, reason: "manifest-disagrees" },
    pluginLine("warn", "Plugin left out: Manifest disagrees with the record"),
  ],
  [
    "Backend spawned",
    { kind: "backend-spawned", plugin },
    pluginLine("info", "Backend spawned"),
  ],
  [
    "Backend exited cleanly",
    { kind: "backend-exited", plugin, exit: { kind: "code", code: 0 } },
    pluginLine("info", "Backend exited with code 0"),
  ],
  [
    "Backend exited with an error code",
    { kind: "backend-exited", plugin, exit: { kind: "code", code: 3 } },
    pluginLine("warn", "Backend exited with code 3"),
  ],
  [
    "Backend exited on a signal",
    {
      kind: "backend-exited",
      plugin,
      exit: { kind: "signal", signal: "SIGKILL" },
    },
    pluginLine("warn", "Backend exited on signal SIGKILL"),
  ],
  [
    "initialize errored",
    { kind: "initialize-failed", plugin, failure: "error" },
    pluginLine("error", "initialize failed: error"),
  ],
  [
    "initialize rejected",
    { kind: "initialize-failed", plugin, failure: "rejected" },
    pluginLine("error", "initialize failed: rejected"),
  ],
  [
    "initialize timed out",
    { kind: "initialize-failed", plugin, failure: "timed-out" },
    pluginLine("error", "initialize failed: timed out"),
  ],
  [
    "AI Provider returned an HTTP error",
    {
      kind: "ai-provider-call-failed",
      provider: parseAiProviderLabel("School Azure"),
      outcome: { kind: "http-status", status: 401 },
    },
    hubLine("warn", "AI Provider call failed: School Azure returned HTTP 401"),
  ],
  [
    "AI Provider gave no response",
    {
      kind: "ai-provider-call-failed",
      provider: parseAiProviderLabel("School Azure"),
      outcome: { kind: "no-response" },
    },
    hubLine("warn", "AI Provider call failed: School Azure gave no response"),
  ],
  [
    "uncaught exception",
    {
      kind: "uncaught-exception",
      origin: "uncaughtException",
      error: uncaught,
    },
    hubLine("error", "uncaughtException: Error\n    at main.ts:1:1"),
  ],
  [
    "uncaught exception without a stack",
    {
      kind: "uncaught-exception",
      origin: "uncaughtException",
      error: Object.assign(new TypeError("boom"), { stack: undefined }),
    },
    hubLine("error", "uncaughtException: TypeError"),
  ],
  [
    "unhandled rejection of a non-Error value",
    {
      kind: "uncaught-exception",
      origin: "unhandledRejection",
      error: { apiKey: "sk-secret" },
    },
    hubLine("error", "unhandledRejection: a non-Error value of type object"),
  ],
  [
    "Hub Chrome renderer gone",
    {
      kind: "hub-chrome-renderer-gone",
      exit: { reason: "oom", exitCode: 137 },
    },
    hubLine("error", "Hub Chrome renderer gone: oom, exit code 137"),
  ],
  [
    "Hub Chrome kept crashing",
    { kind: "hub-chrome-kept-crashing", crashes: 3, withinSeconds: 60 },
    hubLine("error", "Hub Chrome kept crashing: 3 times in 60 s, giving up"),
  ],
];

test.each(cases)(
  "%s is written to hub.log as its expected line",
  (_, event, expected) => {
    const diagnostics = openDiagnostics(logsDir, () => NOW);

    diagnostics.recordHubEvent(event);

    expect(readLines("hub.log")).toEqual([expected]);
  },
);

const crashes: [string, PluginCrash, string][] = [
  [
    "Plugin stopped responding",
    { cause: "stopped-responding" },
    "Plugin closed abnormally: stopped responding",
  ],
  [
    "Plugin UI crashed",
    {
      cause: "crashed",
      exit: { kind: "plugin-ui-gone", exit: { reason: "oom", exitCode: 137 } },
    },
    "Plugin closed abnormally: crashed (Plugin UI gone: oom, exit code 137)",
  ],
  [
    "Backend crashed on a signal",
    {
      cause: "crashed",
      exit: {
        kind: "backend-exited",
        exit: { kind: "signal", signal: "SIGSEGV" },
      },
    },
    "Plugin closed abnormally: crashed (Backend exited on signal SIGSEGV)",
  ],
  [
    "Plugin failed to start with its Backend still running",
    { cause: "failed-to-start", exit: { kind: "no-exit" } },
    "Plugin closed abnormally: failed to start",
  ],
  [
    "Backend broke the protocol with a line that is not JSON-RPC",
    {
      cause: "crashed",
      exit: { kind: "protocol-violation", violation: "not-json-rpc" },
    },
    "Plugin closed abnormally: crashed (protocol violation: a stdout line that is not JSON-RPC)",
  ],
  [
    "Backend broke the protocol with a request",
    {
      cause: "crashed",
      exit: { kind: "protocol-violation", violation: "request" },
    },
    "Plugin closed abnormally: crashed (protocol violation: a request from the Backend)",
  ],
  [
    "Backend broke the protocol with an answer to no request",
    {
      cause: "crashed",
      exit: { kind: "protocol-violation", violation: "unknown-response" },
    },
    "Plugin closed abnormally: crashed (protocol violation: an answer to no request)",
  ],
  [
    "Plugin UI failed to load",
    {
      cause: "failed-to-start",
      exit: { kind: "plugin-ui-load-failed", error: "ERR_FILE_NOT_FOUND" },
    },
    "Plugin closed abnormally: failed to start (Plugin UI failed to load: ERR_FILE_NOT_FOUND)",
  ],
];

test.each(crashes)(
  "%s is written to the Plugin log, and summarised in hub.log once",
  (_, crash, summary) => {
    const diagnostics = openDiagnostics(logsDir, () => NOW);

    diagnostics.startPluginSession(plugin).recordCrash(crash);

    expect(readLines(PLUGIN_LOG)).toEqual([
      sessionLine("hub", "error", summary),
    ]);
    expect(readLines("hub.log")).toEqual([pluginLine("error", summary)]);
  },
);

test("events append to hub.log in order", () => {
  const diagnostics = openDiagnostics(logsDir, () => NOW);

  diagnostics.recordHubEvent({ kind: "hub-opened" });
  diagnostics.recordHubEvent({ kind: "hub-closing" });

  expect(readLines("hub.log")).toEqual([
    hubLine("info", "Hub opened"),
    hubLine("info", "Hub closing"),
  ]);
});

test("hub.log rolls before it would pass the limit, keeping exactly one .1 that a second roll replaces", () => {
  let second = 0;
  const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++second));
  const time = (s: number) =>
    new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
  const oneLineBytes = Buffer.byteLength(
    JSON.stringify({ ...hubLine("info", "Hub opened"), time: time(1) }) + "\n",
  );
  const diagnostics = openDiagnostics(logsDir, tick, oneLineBytes * 2);
  const times = (relativePath: string) =>
    readLines(relativePath).map((line) => (line as { time: string }).time);

  for (let i = 0; i < 3; i++)
    diagnostics.recordHubEvent({ kind: "hub-opened" });
  expect(times("hub.log.1")).toEqual([time(1), time(2)]);
  expect(times("hub.log")).toEqual([time(3)]);

  for (let i = 0; i < 2; i++)
    diagnostics.recordHubEvent({ kind: "hub-opened" });
  expect(times("hub.log.1")).toEqual([time(3), time(4)]);
  expect(times("hub.log")).toEqual([time(5)]);
  expect(readdirSync(logsDir).sort()).toEqual(["hub.log", "hub.log.1"]);
});

test("an uncaught exception's message never reaches hub.log, even across lines, but its stack frames do", () => {
  const diagnostics = openDiagnostics(logsDir, () => NOW);
  const error = new Error("prompt: Mark this essay\nkey sk-secret");
  error.stack =
    "Error: prompt: Mark this essay\nkey sk-secret\n    at mark (main.ts:1:1)\n    at main.ts:2:2";

  diagnostics.recordHubEvent({
    kind: "uncaught-exception",
    origin: "uncaughtException",
    error,
  });

  const log = readFileSync(join(logsDir, "hub.log"), "utf8");
  expect(log).not.toMatch(/Mark this essay|sk-secret/);
  expect(readLines("hub.log")).toEqual([
    hubLine(
      "error",
      "uncaughtException: Error\n    at mark (main.ts:1:1)\n    at main.ts:2:2",
    ),
  ]);
});

test("the Hub-event union cannot express a secret, prompt, reply, file contents or identity", () => {
  const events: HubEvent[] = [
    {
      kind: "sign-in",
      // @ts-expect-error a sign-in result carries no Staff Identity
      result: { signedIn: true, identity: { email: "a@b.c" } },
    },
    {
      kind: "sign-in",
      // @ts-expect-error a sign-in failure carries a closed kind, not free text
      result: { signedIn: false, failure: "bad password hunter2" },
    },
    {
      kind: "ai-provider-call-failed",
      provider: parseAiProviderLabel("School Azure"),
      outcome: { kind: "http-status", status: 401 },
      // @ts-expect-error an AI Provider failure carries no key
      apiKey: "sk-secret",
    },
    {
      kind: "ai-provider-call-failed",
      provider: parseAiProviderLabel("School Azure"),
      // @ts-expect-error an AI Provider failure carries no prompt or reply
      outcome: { kind: "no-response", prompt: "Mark this essay" },
    },
    // @ts-expect-error a Plugin event carries no file contents
    { kind: "plugin-installed", plugin, contents: "student essay" },
    // @ts-expect-error there is no free-text event
    { kind: "message", message: "anything at all" },
    {
      // @ts-expect-error only PluginSession.recordCrash logs a Plugin closing abnormally
      kind: "plugin-closed-abnormally",
      plugin,
      crash: { cause: "stopped-responding" },
    },
  ];
  expect(events).toHaveLength(7);
});

const PLUGIN_LOG = "plugins/marking-assistant.log";

function sessionLine(source: string, level: string, message: string) {
  return { ...pluginLine(level, message), source };
}

test("Plugin UI console messages map their level and debug is dropped", () => {
  const session = openDiagnostics(logsDir, () => NOW).startPluginSession(
    plugin,
  );

  session.recordConsoleMessage("debug", "chatty");
  session.recordConsoleMessage("info", "loaded");
  session.recordConsoleMessage("warning", "slow");
  session.recordConsoleMessage("error", "Uncaught TypeError: x is undefined");

  expect(readLines(PLUGIN_LOG)).toEqual([
    sessionLine("ui", "info", "loaded"),
    sessionLine("ui", "warn", "slow"),
    sessionLine("ui", "error", "Uncaught TypeError: x is undefined"),
  ]);
});

const bytes = (text: string) => Buffer.from(text, "utf8");

test("Backend stderr split across chunks is written as whole verbatim lines, and a partial last line is flushed when the session ends", () => {
  const session = openDiagnostics(logsDir, () => NOW).startPluginSession(
    plugin,
  );
  const euro = bytes("€"); // three bytes, split across chunks below

  session.recordStderr(bytes("Traceback (most rec"));
  session.recordStderr(bytes('ent call last):\r\n  File "x.py"\n\nprice '));
  session.recordStderr(euro.subarray(0, 1));
  session.recordStderr(Buffer.concat([euro.subarray(1), bytes("5\nno newl")]));
  session.recordStderr(bytes("ine"));
  session.end();

  expect(readLines(PLUGIN_LOG)).toEqual([
    sessionLine("backend", "stderr", "Traceback (most recent call last):"),
    sessionLine("backend", "stderr", '  File "x.py"'),
    sessionLine("backend", "stderr", ""),
    sessionLine("backend", "stderr", "price €5"),
    sessionLine("backend", "stderr", "no newline"),
  ]);
});

test("invalid UTF-8 on stderr does not throw", () => {
  const session = openDiagnostics(logsDir, () => NOW).startPluginSession(
    plugin,
  );

  session.recordStderr(Buffer.from([0x62, 0x61, 0x64, 0xff, 0xfe, 0x0a]));
  session.recordStderr(Buffer.from([0xc3]));
  session.end();

  expect(readLines(PLUGIN_LOG)).toEqual([
    sessionLine("backend", "stderr", "bad��"),
    sessionLine("backend", "stderr", "�"),
  ]);
});

test("Plugin UI and Backend lines interleave in one file in the order they arrive", () => {
  const session = openDiagnostics(logsDir, () => NOW).startPluginSession(
    plugin,
  );

  session.recordConsoleMessage("info", "asking for marks");
  session.recordStderr(bytes("marking essay 1\n"));
  session.recordConsoleMessage("error", "request failed");

  expect(readLines(PLUGIN_LOG)).toEqual([
    sessionLine("ui", "info", "asking for marks"),
    sessionLine("backend", "stderr", "marking essay 1"),
    sessionLine("ui", "error", "request failed"),
  ]);
});

test("a JSON-RPC error response is written as its method, data.reason and message only", () => {
  const session = openDiagnostics(logsDir, () => NOW).startPluginSession(
    plugin,
  );
  const response = {
    method: "markEssays",
    reason: parseRpcErrorReason("same-folder"),
    message: "Input and output are the same folder",
    // What the relay also has to hand; none of it may reach the log.
    params: { folder: "C:/Users/staff/essays" },
    result: { marks: [7] },
  };

  session.recordRpcError(response);

  expect(readLines(PLUGIN_LOG)).toEqual([
    sessionLine(
      "hub",
      "error",
      "markEssays failed: same-folder: Input and output are the same folder",
    ),
  ]);
});

test("a JSON-RPC error response without a data.reason is written as its method and message", () => {
  const session = openDiagnostics(logsDir, () => NOW).startPluginSession(
    plugin,
  );

  session.recordRpcError({
    method: "markEssays",
    reason: null,
    message: "Input and output are the same folder",
  });

  expect(readLines(PLUGIN_LOG)).toEqual([
    sessionLine(
      "hub",
      "error",
      "markEssays failed: Input and output are the same folder",
    ),
  ]);
});

test("a crash record carries its cause, exit details and the last 50 stderr lines; hub.log gets the summary without them", () => {
  const diagnostics = openDiagnostics(logsDir, () => NOW);
  const session = diagnostics.startPluginSession(plugin);
  for (let i = 1; i <= 51; i++)
    session.recordStderr(bytes(`line ${String(i)}\n`));
  session.recordStderr(bytes("line 52")); // the dying Backend's unterminated last line

  session.recordCrash({
    cause: "failed-to-start",
    exit: { kind: "backend-exited", exit: { kind: "code", code: 1 } },
  });
  session.end();

  const summary =
    "Plugin closed abnormally: failed to start (Backend exited with code 1)";
  const lastFifty = Array.from(
    { length: 50 },
    (_, i) => `line ${String(i + 3)}`,
  );
  const pluginLog = readLines(PLUGIN_LOG);
  expect(pluginLog).toHaveLength(53);
  expect(pluginLog.at(-1)).toEqual(
    sessionLine(
      "hub",
      "error",
      [summary, "Last 50 stderr lines:", ...lastFifty].join("\n"),
    ),
  );
  expect(readLines("hub.log")).toEqual([pluginLine("error", summary)]);
});

test("a crash with no stderr is written without a stderr section", () => {
  const session = openDiagnostics(logsDir, () => NOW).startPluginSession(
    plugin,
  );

  session.recordCrash({ cause: "stopped-responding" });

  expect(readLines(PLUGIN_LOG)).toEqual([
    sessionLine("hub", "error", "Plugin closed abnormally: stopped responding"),
  ]);
});

test("a Plugin log rolls before it would pass the limit, like hub.log", () => {
  const oneLineBytes = Buffer.byteLength(
    JSON.stringify(sessionLine("ui", "info", "line 1")) + "\n",
  );
  const session = openDiagnostics(
    logsDir,
    () => NOW,
    oneLineBytes * 2,
  ).startPluginSession(plugin);
  const messages = (relativePath: string) =>
    readLines(relativePath).map(
      (line) => (line as { message: string }).message,
    );

  for (let i = 1; i <= 5; i++)
    session.recordConsoleMessage("info", `line ${String(i)}`);

  expect(messages(`${PLUGIN_LOG}.1`)).toEqual(["line 3", "line 4"]);
  expect(messages(PLUGIN_LOG)).toEqual(["line 5"]);
  expect(readdirSync(join(logsDir, "plugins")).sort()).toEqual([
    "marking-assistant.log",
    "marking-assistant.log.1",
  ]);
});

const otherPlugin = {
  id: parsePluginId("pdf-watermark-eraser"),
  version: parsePluginVersion("0.4.0"),
};

/** Fills hub.log, both Plugins' logs and their rolled .1 files. */
function writeEveryKindOfLog() {
  const oneLineBytes = Buffer.byteLength(
    JSON.stringify(sessionLine("ui", "info", "line 1")) + "\n",
  );
  const diagnostics = openDiagnostics(logsDir, () => NOW, oneLineBytes * 2);
  for (const p of [plugin, otherPlugin]) {
    const session = diagnostics.startPluginSession(p);
    for (let i = 1; i <= 3; i++)
      session.recordConsoleMessage("info", `line ${String(i)}`);
  }
  for (let i = 0; i < 3; i++)
    diagnostics.recordHubEvent({ kind: "hub-opened" });
  return diagnostics;
}

test("deleting a Plugin's logs removes its log and .1, leaving other Plugins' logs and hub.log alone", () => {
  const diagnostics = writeEveryKindOfLog();

  diagnostics.deletePluginLogs(plugin.id);

  expect(readdirSync(logsDir).sort()).toEqual([
    "hub.log",
    "hub.log.1",
    "plugins",
  ]);
  expect(readdirSync(join(logsDir, "plugins")).sort()).toEqual([
    "pdf-watermark-eraser.log",
    "pdf-watermark-eraser.log.1",
  ]);
});

test("deleting the logs of a Plugin that never logged does nothing", () => {
  const diagnostics = openDiagnostics(logsDir, () => NOW);

  diagnostics.deletePluginLogs(plugin.id);

  expect(readdirSync(logsDir)).toEqual([]);
});

const system: SystemDescription = {
  hubVersion: parseHubVersion("0.3.0"),
  os: { name: "Windows", version: "10.0.19045", arch: "x64" },
  displayLanguage: "zh-HK",
  theme: "hawkeye",
  colourScheme: "system",
  plugins: [plugin, otherPlugin],
  pythonVersions: [parsePythonVersion("3.12.7")],
  aiProviders: [
    {
      label: parseAiProviderLabel("School Azure"),
      kind: parseAiProviderKind("azure-openai"),
    },
  ],
  authProvider: { kind: "oidc", signedIn: true },
};

/** The exported zip, read back with fflate: entry path to its text. */
function readBundle(path: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(readFileSync(path))).map(([name, data]) => [
      name,
      strFromU8(data),
    ]),
  );
}

function entry(bundle: Record<string, string>, name: string): string {
  const text = bundle[name];
  if (text === undefined) throw new Error(`The bundle has no ${name}`);
  return text;
}

test("an exported bundle holds every log at its path relative to the logs folder plus system.json, and nothing else", () => {
  const diagnostics = writeEveryKindOfLog();
  const { destination } = exportTarget();

  diagnostics.exportBundle(destination, system);

  const bundle = readBundle(destination);
  const logs = [
    "hub.log",
    "hub.log.1",
    "plugins/marking-assistant.log",
    "plugins/marking-assistant.log.1",
    "plugins/pdf-watermark-eraser.log",
    "plugins/pdf-watermark-eraser.log.1",
  ];
  expect(Object.keys(bundle).sort()).toEqual([...logs, "system.json"]);
  for (const log of logs)
    expect(bundle[log]).toBe(readFileSync(join(logsDir, log), "utf8"));
  expect(JSON.parse(entry(bundle, "system.json"))).toEqual({
    hubVersion: "0.3.0",
    os: { name: "Windows", version: "10.0.19045", arch: "x64" },
    displayLanguage: "zh-HK",
    theme: "hawkeye",
    colourScheme: "system",
    plugins: [
      { id: "marking-assistant", version: "1.2.3" },
      { id: "pdf-watermark-eraser", version: "0.4.0" },
    ],
    pythonVersions: ["3.12.7"],
    aiProviders: [{ label: "School Azure", kind: "azure-openai" }],
    authProvider: { kind: "oidc", signedIn: true },
  });
});

test("with no Auth Provider, system.json says so and reports no sign-in", () => {
  const diagnostics = openDiagnostics(logsDir, () => NOW);
  const { destination } = exportTarget();

  diagnostics.exportBundle(destination, {
    ...system,
    authProvider: { kind: "none" },
  });

  const systemJson = entry(readBundle(destination), "system.json");
  expect(JSON.parse(systemJson)).toMatchObject({
    authProvider: { kind: "none" },
  });
  expect(systemJson).not.toMatch(/signedIn/);
});

test("a bundle exported before any Plugin has logged holds hub.log and system.json", () => {
  const diagnostics = openDiagnostics(logsDir, () => NOW);
  diagnostics.recordHubEvent({ kind: "hub-opened" });
  const { destination } = exportTarget();

  diagnostics.exportBundle(destination, system);

  expect(Object.keys(readBundle(destination)).sort()).toEqual([
    "hub.log",
    "system.json",
  ]);
});

test("system.json holds only the described fields, even when handed an object with more", () => {
  const diagnostics = openDiagnostics(logsDir, () => NOW);
  const { destination } = exportTarget();
  const settings = {
    ...system,
    aiProviders: [{ ...system.aiProviders[0], apiKey: "sk-secret" }],
    authProvider: { kind: "oidc", signedIn: true, identity: "a@b.c" },
    staffIdentity: { email: "a@b.c" },
  };

  diagnostics.exportBundle(destination, settings as SystemDescription);

  expect(entry(readBundle(destination), "system.json")).not.toMatch(
    /sk-secret|a@b\.c|apiKey|identity|staffIdentity/,
  );
});

test("a failed export leaves no file at the destination and nothing beside it", () => {
  const diagnostics = writeEveryKindOfLog();
  mkdirSync(join(logsDir, "plugins", "unreadable.log")); // a log that cannot be read
  const { folder, destination } = exportTarget();

  expect(() => {
    diagnostics.exportBundle(destination, system);
  }).toThrow();

  expect(readdirSync(folder)).toEqual([]);
});

test("an export that fails while moving the zip into place leaves no temp file behind", () => {
  const diagnostics = writeEveryKindOfLog();
  const { folder, destination } = exportTarget();
  mkdirSync(join(destination, "occupied"), { recursive: true }); // a zip cannot replace a folder

  expect(() => {
    diagnostics.exportBundle(destination, system);
  }).toThrow();

  expect(readdirSync(folder)).toEqual(["b.zip"]);
});

test("constrained strings are parsed, not taken as bare strings", () => {
  expect(() => parsePluginId("Marking_Assistant")).toThrow();
  expect(() => parsePluginVersion("1.2")).toThrow();
  expect(() => parseHubVersion("v0.3")).toThrow();
  expect(() => parsePythonVersion("3.12")).toThrow();
  expect(parsePythonVersion("3.14.0rc1")).toBe("3.14.0rc1");
  expect(() => parseAiProviderLabel(" ")).toThrow();
  expect(() => parseAiProviderKind("Azure OpenAI")).toThrow();
  expect(() => parseRpcErrorReason("Same folder")).toThrow();
  expect(() => parseAbsolutePath("logs")).toThrow();
});
