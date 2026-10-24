// Diagnostics (ADR 0012): the only code that writes or reads the Hub's log files.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import type { DisplayLanguage, ThemeName } from "../shared/hub-chrome-ipc";
import { HAWKEYE } from "./lifecycle";
import type { InstallFailure } from "./plugin-install";
import type { RegistryCheckFailure } from "./registry";
import type {
  AbsolutePath,
  AiProviderKind,
  AiProviderLabel,
  HubVersion,
  PluginId,
  PluginVersion,
  PythonVersion,
  RpcErrorReason,
} from "./ids";

export const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;

export interface PluginRef {
  id: PluginId;
  version: PluginVersion;
}

export type SignInFailure =
  | "cancelled"
  | "invalid-credentials"
  | "provider-unreachable"
  | "provider-error";

/** Why an installed Plugin's entry in the record could not be loaded. */
export type PluginLeftOutReason =
  "folder-missing" | "manifest-invalid" | "manifest-disagrees";

const LEFT_OUT_REASONS = {
  "folder-missing": "folder missing",
  "manifest-invalid": "Manifest invalid",
  "manifest-disagrees": "Manifest disagrees with the record",
} satisfies Record<PluginLeftOutReason, string>;

/** What was wrong with a Hub Settings file the Hub overwrote with the first-launch values. */
export type HubSettingsProblem = "unreadable" | "not-json" | "invalid";

const HUB_SETTINGS_PROBLEMS = {
  unreadable: "unreadable",
  "not-json": "not JSON",
  invalid: "invalid",
} satisfies Record<HubSettingsProblem, string>;

export type BackendExit =
  { kind: "code"; code: number } | { kind: "signal"; signal: NodeJS.Signals };

/** Electron's `RenderProcessGoneDetails["reason"]`. */
export type RenderProcessGoneReason =
  | "clean-exit"
  | "abnormal-exit"
  | "killed"
  | "crashed"
  | "oom"
  | "launch-failed"
  | "integrity-failure"
  | "memory-eviction";

/** How a renderer (a Plugin UI or the Hub Chrome) went away: Electron's `render-process-gone`. */
export interface RenderProcessExit {
  reason: RenderProcessGoneReason;
  exitCode: number;
}

/** How many of a Backend's last stderr lines a crash record carries. */
export const CRASH_STDERR_TAIL_LINES = 50;

interface PluginUiGone {
  kind: "plugin-ui-gone";
  exit: RenderProcessExit;
}
interface BackendExited {
  kind: "backend-exited";
  exit: BackendExit;
}
// The Backend never spawned, or was still running when `initialize` failed or timed out.
interface NoExit {
  kind: "no-exit";
}

/**
 * How a Backend, or the Plugin UI talking to it, broke the wire protocol (ADR 0009). Never the
 * offending message: it may hold anything.
 */
export type ProtocolViolation =
  // A stdout line that is not a JSON-RPC response or notification.
  | "not-json-rpc"
  // Only the Plugin UI sends requests.
  | "request"
  // A response whose id no relayed request had.
  | "unknown-response"
  // A message from the Plugin UI that is not a JSON-RPC request or notification.
  | "ui-not-json-rpc";

const PROTOCOL_VIOLATIONS = {
  "not-json-rpc": "a stdout line that is not JSON-RPC",
  request: "a request from the Backend",
  "unknown-response": "an answer to no request",
  "ui-not-json-rpc": "a Plugin UI message that is not JSON-RPC",
} satisfies Record<ProtocolViolation, string>;

interface ProtocolViolated {
  kind: "protocol-violation";
  violation: ProtocolViolation;
}

/** Chromium's name for a network error, such as `ERR_FILE_NOT_FOUND`. */
export type NetErrorCode = `ERR_${string}`;

// The Plugin UI's main frame failed to load before its first successful load.
interface PluginUiLoadFailed {
  kind: "plugin-ui-load-failed";
  error: NetErrorCode;
}

/** A Plugin closing abnormally (ADR 0012), with what each cause can report about the exit. */
export type PluginCrash =
  | { cause: "crashed"; exit: PluginUiGone | BackendExited | ProtocolViolated }
  | {
      cause: "failed-to-start";
      exit: BackendExited | NoExit | PluginUiLoadFailed;
    }
  // The Plugin UI is hung, not gone, and the Backend has done nothing wrong.
  | { cause: "stopped-responding" };

export type PluginCrashCause = PluginCrash["cause"];

/**
 * Everything callers may write to hub.log. ADR 0012's privacy rule lives here: no variant has a
 * field that can hold a key, token, prompt, reply, file contents or Staff Identity. Adding a
 * variant is a deliberate choice about what the Hub log may hold. A Plugin closing abnormally is
 * not one: `PluginSession.recordCrash` writes its summary, so it cannot be logged twice.
 */
export type HubEvent =
  | { kind: "hub-opened" }
  | { kind: "hub-closing" }
  | { kind: "plugin-installed"; plugin: PluginRef }
  | {
      kind: "plugin-updated";
      plugin: PluginRef;
      previousVersion: PluginVersion;
    }
  | { kind: "plugin-uninstalled"; plugin: PluginRef }
  // An entry in the record of installed Plugins that could not be loaded, so it is not listed.
  | { kind: "plugin-left-out"; plugin: PluginRef; reason: PluginLeftOutReason }
  | {
      kind: "sign-in";
      result: { signedIn: true } | { signedIn: false; failure: SignInFailure };
    }
  | { kind: "backend-spawned"; plugin: PluginRef }
  | { kind: "backend-exited"; plugin: PluginRef; exit: BackendExit }
  | {
      kind: "initialize-failed";
      plugin: PluginRef;
      failure: "error" | "rejected" | "timed-out";
    }
  | {
      kind: "ai-provider-call-failed";
      provider: AiProviderLabel;
      outcome:
        { kind: "http-status"; status: number } | { kind: "no-response" };
    }
  // A Registry check that failed: only how, never the index's contents.
  | { kind: "registry-check-failed"; failure: RegistryCheckFailure }
  // An `environment` failure carries the end of uv's stderr, which says what went wrong.
  | ({ kind: "plugin-install-failed"; plugin: PluginRef } & InstallFailure)
  // A silent update's version that failed to build; the installed version is kept.
  | ({ kind: "plugin-update-failed"; plugin: PluginRef } & InstallFailure)
  // A Plugin folder the launch sweep deleted: `.partial`, or a version the record does not name.
  | { kind: "plugin-swept"; plugin: PluginRef; partial: boolean }
  | {
      kind: "uncaught-exception";
      origin: NodeJS.UncaughtExceptionOrigin;
      // Only an Error's name and stack frames are written, never its message; any other thrown
      // value is reduced to its type.
      error: unknown;
    }
  | { kind: "hub-chrome-renderer-gone"; exit: RenderProcessExit }
  // The Hub Settings file was damaged and overwritten with the first-launch values. Never its
  // contents, only what was wrong with it.
  | { kind: "hub-settings-replaced"; problem: HubSettingsProblem }
  // The first-launch values could not be written over the Hub Settings file: the fs error's code.
  | { kind: "hub-settings-unwritable"; code: string }
  // A stored or company Theme this Hub does not have, so it draws in Hawkeye instead.
  | { kind: "theme-unknown"; name: ThemeName }
  // The AI Provider key file could not be decrypted or parsed, so the Hub starts with no keys.
  // Never its contents.
  | { kind: "ai-keys-unreadable" }
  // `assistant-models.json` was damaged, so every Plugin's Assistant is on Default. Never its
  // contents.
  | { kind: "assistant-models-unreadable" }
  // The Hub stopped reloading a Hub Chrome that crashed this many times this quickly.
  | {
      kind: "hub-chrome-kept-crashing";
      crashes: number;
      withinSeconds: number;
    };

// Written to hub.log only by `PluginSession.recordCrash`, so it is deliberately not a HubEvent.
interface PluginClosedAbnormally {
  kind: "plugin-closed-abnormally";
  plugin: PluginRef;
  crash: PluginCrash;
}

export type HubLevel = "info" | "warn" | "error";

// A line is about one Plugin, or about none: the null pair is a real state, not a missing value.
type LineSubject =
  | { pluginId: PluginId; pluginVersion: PluginVersion }
  | { pluginId: null; pluginVersion: null };

// The Hub does not parse what it did not write, so Backend lines get their own level.
type LineOrigin =
  | { source: "hub" | "ui"; level: HubLevel }
  | { source: "backend"; level: "stderr" };

export type LogLine = { time: string; message: string } & LineOrigin &
  LineSubject;

/** Electron's `console-message` event `level`. */
export type ConsoleMessageLevel = "debug" | "info" | "warning" | "error";

/** A JSON-RPC error response, reduced to what may be logged: never its params or result. */
export interface RpcError {
  method: string;
  // Null when the error has no `data.reason`: only SDK Backends send one, and a raw JSON-RPC
  // Backend is still a valid Backend.
  reason: RpcErrorReason | null;
  message: string;
}

/** One open Plugin's capture into its own `plugins/<id>.log`. */
export interface PluginSession {
  recordConsoleMessage(level: ConsoleMessageLevel, message: string): void;
  /** Raw Backend stderr bytes, written line by line. */
  recordStderr(chunk: Uint8Array): void;
  recordRpcError(error: RpcError): void;
  /**
   * Writes the full crash record, with the Backend's last stderr lines, to the Plugin's log and
   * a summary without them to hub.log.
   */
  recordCrash(crash: PluginCrash): void;
  /** Writes any held partial stderr line. Call once, when the Plugin closes. */
  end(): void;
}

export interface Diagnostics {
  recordHubEvent(event: HubEvent): void;
  startPluginSession(plugin: PluginRef): PluginSession;
  /** Removes the Plugin's log and its `.1`, for uninstall with "also delete my data". */
  deletePluginLogs(id: PluginId): void;
  /**
   * Writes the Diagnostics Bundle zip: every `hub.log*` and `plugins/*.log*` plus `system.json`.
   * The zip only ever appears at `destination` whole.
   */
  exportBundle(destination: AbsolutePath, system: SystemDescription): void;
}

export type { DisplayLanguage };

/**
 * The installation as `system.json` describes it (ADR 0012). It has no field for a key, endpoint,
 * Plugin Data, Shared Store contents or Staff Identity.
 */
export interface SystemDescription {
  hubVersion: HubVersion;
  os: { name: string; version: string; arch: string };
  displayLanguage: DisplayLanguage;
  theme: ThemeName;
  colourScheme: "system" | "light" | "dark";
  plugins: PluginRef[];
  pythonVersions: PythonVersion[];
  aiProviders: { label: AiProviderLabel; kind: AiProviderKind }[];
  // ADR 0002: with no Auth Provider there is no sign-in to report.
  authProvider: { kind: "none" } | { kind: "ldap" | "oidc"; signedIn: boolean };
}

// Every file Diagnostics writes: a log or its one rolled `.1`.
const HUB_LOG_FILE = /^hub\.log(\.1)?$/;
const PLUGIN_LOG_FILE = /\.log(\.1)?$/;

/** Copies exactly the described fields, so nothing else a caller's object holds is written. */
function describeSystem(system: SystemDescription): SystemDescription {
  return {
    hubVersion: system.hubVersion,
    os: {
      name: system.os.name,
      version: system.os.version,
      arch: system.os.arch,
    },
    displayLanguage: system.displayLanguage,
    theme: system.theme,
    colourScheme: system.colourScheme,
    plugins: system.plugins.map(({ id, version }) => ({ id, version })),
    pythonVersions: system.pythonVersions,
    aiProviders: system.aiProviders.map(({ label, kind }) => ({ label, kind })),
    authProvider:
      system.authProvider.kind === "none"
        ? { kind: "none" }
        : {
            kind: system.authProvider.kind,
            signedIn: system.authProvider.signedIn,
          },
  };
}

/** The Diagnostics Bundle's file name, `hawkeye-hub-diagnostics-<yyyymmdd-hhmmss>.zip` in local time. */
export function bundleFileName(time: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  const date = `${String(time.getFullYear())}${two(time.getMonth() + 1)}${two(time.getDate())}`;
  const clock = `${two(time.getHours())}${two(time.getMinutes())}${two(time.getSeconds())}`;
  return `hawkeye-hub-diagnostics-${date}-${clock}.zip`;
}

export function openDiagnostics(
  logsDir: AbsolutePath,
  now: () => Date,
  // A tunable knob defaulting to a named constant (CODING_STANDARDS); tests pass a smaller one.
  maxLogFileBytes: number = MAX_LOG_FILE_BYTES,
): Diagnostics {
  mkdirSync(logsDir, { recursive: true });

  function writeLine(
    relativePath: string,
    origin: LineOrigin,
    message: string,
    subject: LineSubject,
  ): void {
    const path = join(logsDir, relativePath);
    const line: LogLine = {
      time: now().toISOString(),
      ...origin,
      message,
      ...subject,
    };
    const text = JSON.stringify(line) + "\n";
    // A log not created yet has no bytes: statSync returns undefined only for a missing file.
    const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
    if (size > 0 && size + Buffer.byteLength(text) > maxLogFileBytes) {
      renameSync(path, `${path}.1`);
    }
    appendFileSync(path, text);
  }

  function writeHubLog(entry: HubEvent | PluginClosedAbnormally): void {
    const { level, message, subject } = summarizeHubEvent(entry);
    writeLine("hub.log", { source: "hub", level }, message, subject);
  }

  return {
    recordHubEvent: writeHubLog,

    deletePluginLogs(id) {
      const path = join(logsDir, pluginLogPath(id));
      // force: a Plugin that never logged, or never rolled, has nothing to delete.
      rmSync(path, { force: true });
      rmSync(`${path}.1`, { force: true });
    },

    exportBundle(destination, system) {
      const pluginsDir = join(logsDir, "plugins");
      // Zip paths always use "/", whatever the OS.
      const logs = [
        ...readdirSync(logsDir).filter((name) => HUB_LOG_FILE.test(name)),
        // No plugins/ folder until the first Plugin opens.
        ...(existsSync(pluginsDir) ? readdirSync(pluginsDir) : [])
          .filter((name) => PLUGIN_LOG_FILE.test(name))
          .map((name) => `plugins/${name}`),
      ];
      const zip = zipSync({
        ...Object.fromEntries(
          logs.map((log) => [log, readFileSync(join(logsDir, log))]),
        ),
        "system.json": strToU8(JSON.stringify(describeSystem(system), null, 2)),
      });
      const temp = `${destination}.partial`;
      try {
        writeFileSync(temp, zip);
        renameSync(temp, destination);
      } catch (error) {
        rmSync(temp, { force: true });
        throw error;
      }
    },

    startPluginSession(plugin) {
      mkdirSync(join(logsDir, "plugins"), { recursive: true });
      const logPath = pluginLogPath(plugin.id);
      const subject = subjectOf(plugin);
      // Not fatal: invalid bytes become U+FFFD rather than throwing. Streaming keeps a
      // character split across chunks whole.
      const decoder = new TextDecoder("utf-8");
      let partialLine = "";
      const stderrTail: string[] = [];

      function writeStderrLine(message: string): void {
        stderrTail.push(message);
        if (stderrTail.length > CRASH_STDERR_TAIL_LINES) stderrTail.shift();
        writeLine(
          logPath,
          { source: "backend", level: "stderr" },
          message,
          subject,
        );
      }

      function flushPartialLine(): void {
        const rest = partialLine + decoder.decode();
        partialLine = "";
        if (rest !== "") writeStderrLine(rest);
      }

      return {
        recordConsoleMessage(level, message) {
          if (level === "debug") return;
          writeLine(
            logPath,
            { source: "ui", level: level === "warning" ? "warn" : level },
            message,
            subject,
          );
        },

        recordStderr(chunk) {
          // A Windows Python writes CRLF; the CR is line ending, not content.
          const lines = (
            partialLine + decoder.decode(chunk, { stream: true })
          ).split(/\r?\n/);
          // split always yields at least one element: the (possibly empty) partial last line.
          partialLine = lines.pop() ?? "";
          lines.forEach(writeStderrLine);
        },

        recordRpcError({ method, reason, message }) {
          writeLine(
            logPath,
            { source: "hub", level: "error" },
            reason === null
              ? `${method} failed: ${message}`
              : `${method} failed: ${reason}: ${message}`,
            subject,
          );
        },

        recordCrash(crash) {
          // A dying Backend's last line often has no newline, and it belongs in the tail.
          flushPartialLine();
          const entry: PluginClosedAbnormally = {
            kind: "plugin-closed-abnormally",
            plugin,
            crash,
          };
          const { message } = summarizeHubEvent(entry);
          writeLine(
            logPath,
            { source: "hub", level: "error" },
            stderrTail.length === 0
              ? message
              : [
                  message,
                  `Last ${String(stderrTail.length)} stderr lines:`,
                  ...stderrTail,
                ].join("\n"),
            subject,
          );
          writeHubLog(entry);
        },

        end: flushPartialLine,
      };
    },
  };
}

function pluginLogPath(id: PluginId): string {
  return `plugins/${id}.log`;
}

const NO_PLUGIN: LineSubject = { pluginId: null, pluginVersion: null };

function describeInstallFailure(failure: InstallFailure): string {
  return failure.cause === "environment"
    ? `${failure.cause}\n${failure.stderr}`
    : failure.cause;
}

function subjectOf(plugin: PluginRef): LineSubject {
  return { pluginId: plugin.id, pluginVersion: plugin.version };
}

function summarizeHubEvent(event: HubEvent | PluginClosedAbnormally): {
  level: HubLevel;
  message: string;
  subject: LineSubject;
} {
  switch (event.kind) {
    case "hub-opened":
      return { level: "info", message: "Hub opened", subject: NO_PLUGIN };
    case "hub-closing":
      return { level: "info", message: "Hub closing", subject: NO_PLUGIN };
    case "plugin-installed":
      return {
        level: "info",
        message: "Plugin installed",
        subject: subjectOf(event.plugin),
      };
    case "plugin-updated":
      return {
        level: "info",
        message: `Plugin updated from ${event.previousVersion}`,
        subject: subjectOf(event.plugin),
      };
    case "plugin-uninstalled":
      return {
        level: "info",
        message: "Plugin uninstalled",
        subject: subjectOf(event.plugin),
      };
    case "plugin-left-out":
      return {
        level: "warn",
        message: `Plugin left out: ${LEFT_OUT_REASONS[event.reason]}`,
        subject: subjectOf(event.plugin),
      };
    case "sign-in":
      return event.result.signedIn
        ? { level: "info", message: "Signed in", subject: NO_PLUGIN }
        : {
            level: "warn",
            message: `Sign-in failed: ${kebabToWords(event.result.failure)}`,
            subject: NO_PLUGIN,
          };
    case "backend-spawned":
      return {
        level: "info",
        message: "Backend spawned",
        subject: subjectOf(event.plugin),
      };
    case "backend-exited":
      return {
        level:
          event.exit.kind === "code" && event.exit.code === 0 ? "info" : "warn",
        message: describeBackendExit(event.exit),
        subject: subjectOf(event.plugin),
      };
    case "initialize-failed":
      return {
        level: "error",
        message: `initialize failed: ${kebabToWords(event.failure)}`,
        subject: subjectOf(event.plugin),
      };
    case "ai-provider-call-failed":
      return {
        level: "warn",
        message: `AI Provider call failed: ${event.provider} ${
          event.outcome.kind === "http-status"
            ? `returned HTTP ${String(event.outcome.status)}`
            : "gave no response"
        }`,
        subject: NO_PLUGIN,
      };
    case "registry-check-failed":
      return {
        level: "warn",
        message: `Registry check failed: ${describeRegistryFailure(event.failure)}`,
        subject: NO_PLUGIN,
      };
    case "plugin-install-failed":
      return {
        level: "error",
        message: `Plugin install failed: ${describeInstallFailure(event)}`,
        subject: subjectOf(event.plugin),
      };
    case "plugin-update-failed":
      return {
        level: "error",
        message: `Plugin update failed: ${describeInstallFailure(event)}`,
        subject: subjectOf(event.plugin),
      };
    case "plugin-swept":
      return {
        level: "warn",
        message: `Plugin folder swept: ${event.partial ? "partial" : "not in the record"}`,
        subject: subjectOf(event.plugin),
      };
    case "uncaught-exception":
      return {
        level: "error",
        message: `${event.origin}: ${describeThrown(event.error)}`,
        subject: NO_PLUGIN,
      };
    case "hub-chrome-renderer-gone":
      return {
        level: "error",
        message: `Hub Chrome renderer gone: ${describeRenderProcessExit(event.exit)}`,
        subject: NO_PLUGIN,
      };
    case "hub-settings-replaced":
      return {
        level: "warn",
        message: `Hub Settings replaced with first-launch values: ${HUB_SETTINGS_PROBLEMS[event.problem]}`,
        subject: NO_PLUGIN,
      };
    case "hub-settings-unwritable":
      return {
        level: "error",
        message: `Hub Settings could not be written: ${event.code}`,
        subject: NO_PLUGIN,
      };
    case "theme-unknown":
      return {
        level: "warn",
        message: `Theme ${event.name} unknown to this Hub, using ${HAWKEYE}`,
        subject: NO_PLUGIN,
      };
    case "ai-keys-unreadable":
      return {
        level: "warn",
        message: "AI Provider keys unreadable, starting with none",
        subject: NO_PLUGIN,
      };
    case "assistant-models-unreadable":
      return {
        level: "warn",
        message: "Assistant models unreadable, every Plugin on Default",
        subject: NO_PLUGIN,
      };
    case "hub-chrome-kept-crashing":
      return {
        level: "error",
        message: `Hub Chrome kept crashing: ${String(event.crashes)} times in ${String(event.withinSeconds)} s, giving up`,
        subject: NO_PLUGIN,
      };
    case "plugin-closed-abnormally":
      return {
        level: "error",
        message: `Plugin closed abnormally: ${describeCrash(event.crash)}`,
        subject: subjectOf(event.plugin),
      };
    default:
      return event satisfies never;
  }
}

function describeRegistryFailure(failure: RegistryCheckFailure): string {
  switch (failure.kind) {
    case "http-status":
      return `returned HTTP ${String(failure.status)}`;
    case "no-response":
      return "gave no response";
    case "invalid":
      return "sent an invalid index";
    default:
      return failure satisfies never;
  }
}

// An Error's message is free text that may hold a secret or a prompt, so only its name and the
// stack's frame lines (V8 indents each and starts it with "at ") are kept.
function describeThrown(error: unknown): string {
  if (!(error instanceof Error)) {
    return `a non-Error value of type ${typeof error}`;
  }
  // `stack` is non-standard and may be absent; then there are no frames to keep.
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line));
  return [error.name, ...frames].join("\n");
}

function describeRenderProcessExit(exit: RenderProcessExit): string {
  return `${exit.reason}, exit code ${String(exit.exitCode)}`;
}

function describeBackendExit(exit: BackendExit): string {
  return exit.kind === "code"
    ? `Backend exited with code ${String(exit.code)}`
    : `Backend exited on signal ${exit.signal}`;
}

function describeCrash(crash: PluginCrash): string {
  const cause = kebabToWords(crash.cause);
  if (crash.cause === "stopped-responding") return cause;
  switch (crash.exit.kind) {
    case "plugin-ui-gone":
      return `${cause} (Plugin UI gone: ${describeRenderProcessExit(crash.exit.exit)})`;
    case "backend-exited":
      return `${cause} (${describeBackendExit(crash.exit.exit)})`;
    case "no-exit":
      return cause;
    case "protocol-violation":
      return `${cause} (protocol violation: ${PROTOCOL_VIOLATIONS[crash.exit.violation]})`;
    case "plugin-ui-load-failed":
      return `${cause} (Plugin UI failed to load: ${crash.exit.error})`;
    default:
      return crash.exit satisfies never;
  }
}

function kebabToWords(kebab: string): string {
  return kebab.replaceAll("-", " ");
}
