import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { openDiagnostics, type HubEvent } from "./diagnostics";
import { parseAiProviderLabel, parsePluginId, parsePluginVersion } from "./ids";

const NOW = new Date("2026-03-04T05:06:07.890Z");
const plugin = {
  id: parsePluginId("marking-assistant"),
  version: parsePluginVersion("1.2.3"),
};
let logsDir: string;

beforeEach(() => {
  logsDir = mkdtempSync(join(tmpdir(), "hub-diagnostics-"));
});

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
    hubLine("error", "uncaughtException: Error: boom\n    at main.ts:1:1"),
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
    { kind: "hub-chrome-renderer-gone", reason: "oom", exitCode: 137 },
    hubLine("error", "Hub Chrome renderer gone: oom (exit code 137)"),
  ],
  [
    "Plugin stopped responding",
    {
      kind: "plugin-closed-abnormally",
      plugin,
      crash: { cause: "stopped-responding" },
    },
    pluginLine("error", "Plugin closed abnormally: stopped responding"),
  ],
  [
    "Plugin UI crashed",
    {
      kind: "plugin-closed-abnormally",
      plugin,
      crash: {
        cause: "crashed",
        exit: { kind: "plugin-ui-gone", reason: "oom", exitCode: 137 },
      },
    },
    pluginLine(
      "error",
      "Plugin closed abnormally: crashed (Plugin UI gone: oom, exit code 137)",
    ),
  ],
  [
    "Backend crashed on a signal",
    {
      kind: "plugin-closed-abnormally",
      plugin,
      crash: {
        cause: "crashed",
        exit: {
          kind: "backend-exited",
          exit: { kind: "signal", signal: "SIGSEGV" },
        },
      },
    },
    pluginLine(
      "error",
      "Plugin closed abnormally: crashed (Backend exited on signal SIGSEGV)",
    ),
  ],
  [
    "Plugin failed to start with its Backend still running",
    {
      kind: "plugin-closed-abnormally",
      plugin,
      crash: { cause: "failed-to-start", exit: { kind: "no-exit" } },
    },
    pluginLine("error", "Plugin closed abnormally: failed to start"),
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
  ];
  expect(events).toHaveLength(6);
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
    reason: "same-folder",
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

test("Plugin ids and versions are parsed, not taken as bare strings", () => {
  expect(() => parsePluginId("Marking_Assistant")).toThrow();
  expect(() => parsePluginVersion("1.2")).toThrow();
  expect(() => parseAiProviderLabel(" ")).toThrow();
});
