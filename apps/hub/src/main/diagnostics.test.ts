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
    "Plugin closed abnormally",
    { kind: "plugin-closed-abnormally", plugin, cause: "stopped-responding" },
    pluginLine("error", "Plugin closed abnormally: stopped responding"),
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

test("Plugin ids and versions are parsed, not taken as bare strings", () => {
  expect(() => parsePluginId("Marking_Assistant")).toThrow();
  expect(() => parsePluginVersion("1.2")).toThrow();
  expect(() => parseAiProviderLabel(" ")).toThrow();
});
