// Diagnostics (ADR 0012): the only code that writes or reads the Hub's log files.

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AiProviderLabel, PluginId, PluginVersion } from "./ids";

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

/** How many of a Backend's last stderr lines a crash record carries. */
export const CRASH_STDERR_TAIL_LINES = 50;

interface PluginUiGone {
  kind: "plugin-ui-gone";
  reason: RenderProcessGoneReason;
  exitCode: number;
}
interface BackendExited {
  kind: "backend-exited";
  exit: BackendExit;
}
// The Backend never spawned, or was still running when `initialize` failed or timed out.
interface NoExit {
  kind: "no-exit";
}

/** A Plugin closing abnormally (ADR 0012), with what each cause can report about the exit. */
export type PluginCrash =
  | { cause: "crashed"; exit: PluginUiGone | BackendExited }
  | { cause: "failed-to-start"; exit: BackendExited | NoExit }
  // The Plugin UI is hung, not gone, and the Backend has done nothing wrong.
  | { cause: "stopped-responding" };

export type PluginCrashCause = PluginCrash["cause"];

/**
 * Everything the Hub may write to hub.log. ADR 0012's privacy rule lives here: no variant has a
 * field that can hold a key, token, prompt, reply, file contents or Staff Identity. Adding a
 * variant is a deliberate choice about what the Hub log may hold.
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
  | {
      kind: "uncaught-exception";
      origin: NodeJS.UncaughtExceptionOrigin;
      // Only an Error's stack is written; any other thrown value is reduced to its type.
      error: unknown;
    }
  | {
      kind: "hub-chrome-renderer-gone";
      reason: RenderProcessGoneReason;
      exitCode: number;
    }
  | {
      kind: "plugin-closed-abnormally";
      plugin: PluginRef;
      crash: PluginCrash;
    };

export type HubLevel = "info" | "warn" | "error";

// A line is about one Plugin, or about none: the null pair is a real state, not a missing value.
type LineSubject =
  | { pluginId: PluginId; pluginVersion: PluginVersion }
  | { pluginId: null; pluginVersion: null };

// The Hub does not parse what it did not write, so Backend lines get their own level.
export type LogLine = {
  time: string;
  message: string;
} & (
  | { source: "hub" | "ui"; level: HubLevel }
  | { source: "backend"; level: "stderr" }
) &
  LineSubject;

/** Electron's `console-message` event `level`. */
export type ConsoleMessageLevel = "debug" | "info" | "warning" | "error";

/** A JSON-RPC error response, reduced to what may be logged: never its params or result. */
export interface RpcError {
  method: string;
  /** `error.data.reason`, the kebab-case code every SDK Backend sends. */
  reason: string;
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
   * a summary without them to hub.log. Callers do not also record `plugin-closed-abnormally`.
   */
  recordCrash(crash: PluginCrash): void;
  /** Writes any held partial stderr line. Call once, when the Plugin closes. */
  end(): void;
}

export interface Diagnostics {
  recordHubEvent(event: HubEvent): void;
  startPluginSession(plugin: PluginRef): PluginSession;
}

export function openDiagnostics(
  logsDir: string,
  now: () => Date,
  maxLogFileBytes: number = MAX_LOG_FILE_BYTES,
): Diagnostics {
  mkdirSync(logsDir, { recursive: true });

  function append(relativePath: string, line: LogLine): void {
    const path = join(logsDir, relativePath);
    const text = JSON.stringify(line) + "\n";
    const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
    if (size > 0 && size + Buffer.byteLength(text) > maxLogFileBytes) {
      renameSync(path, `${path}.1`);
    }
    appendFileSync(path, text);
  }

  function recordHubEvent(event: HubEvent): void {
    const { level, message, subject } = describe(event);
    append("hub.log", {
      time: now().toISOString(),
      source: "hub",
      level,
      message,
      ...subject,
    });
  }

  return {
    recordHubEvent,

    startPluginSession(plugin) {
      mkdirSync(join(logsDir, "plugins"), { recursive: true });
      const logPath = `plugins/${plugin.id}.log`;
      const subject = about(plugin);
      // Not fatal: invalid bytes become U+FFFD rather than throwing. Streaming keeps a
      // character split across chunks whole.
      const decoder = new TextDecoder("utf-8");
      let partialLine = "";
      const stderrTail: string[] = [];

      function writeStderrLine(message: string): void {
        stderrTail.push(message);
        if (stderrTail.length > CRASH_STDERR_TAIL_LINES) stderrTail.shift();
        append(logPath, {
          time: now().toISOString(),
          source: "backend",
          level: "stderr",
          message,
          ...subject,
        });
      }

      function flushPartialLine(): void {
        const rest = partialLine + decoder.decode();
        partialLine = "";
        if (rest !== "") writeStderrLine(rest);
      }

      return {
        recordConsoleMessage(level, message) {
          if (level === "debug") return;
          append(logPath, {
            time: now().toISOString(),
            source: "ui",
            level: level === "warning" ? "warn" : level,
            message,
            ...subject,
          });
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
          append(logPath, {
            time: now().toISOString(),
            source: "hub",
            level: "error",
            message: `${method} failed: ${reason}: ${message}`,
            ...subject,
          });
        },

        recordCrash(crash) {
          // A dying Backend's last line often has no newline, and it belongs in the tail.
          flushPartialLine();
          const event: HubEvent = {
            kind: "plugin-closed-abnormally",
            plugin,
            crash,
          };
          const { message } = describe(event);
          append(logPath, {
            time: now().toISOString(),
            source: "hub",
            level: "error",
            message:
              stderrTail.length === 0
                ? message
                : [
                    message,
                    `Last ${String(stderrTail.length)} stderr lines:`,
                    ...stderrTail,
                  ].join("\n"),
            ...subject,
          });
          recordHubEvent(event);
        },

        end: flushPartialLine,
      };
    },
  };
}

const NO_PLUGIN: LineSubject = { pluginId: null, pluginVersion: null };

function about(plugin: PluginRef): LineSubject {
  return { pluginId: plugin.id, pluginVersion: plugin.version };
}

function describe(event: HubEvent): {
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
        subject: about(event.plugin),
      };
    case "plugin-updated":
      return {
        level: "info",
        message: `Plugin updated from ${event.previousVersion}`,
        subject: about(event.plugin),
      };
    case "plugin-uninstalled":
      return {
        level: "info",
        message: "Plugin uninstalled",
        subject: about(event.plugin),
      };
    case "sign-in":
      return event.result.signedIn
        ? { level: "info", message: "Signed in", subject: NO_PLUGIN }
        : {
            level: "warn",
            message: `Sign-in failed: ${words(event.result.failure)}`,
            subject: NO_PLUGIN,
          };
    case "backend-spawned":
      return {
        level: "info",
        message: "Backend spawned",
        subject: about(event.plugin),
      };
    case "backend-exited":
      return {
        level:
          event.exit.kind === "code" && event.exit.code === 0 ? "info" : "warn",
        message: describeBackendExit(event.exit),
        subject: about(event.plugin),
      };
    case "initialize-failed":
      return {
        level: "error",
        message: `initialize failed: ${words(event.failure)}`,
        subject: about(event.plugin),
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
    case "uncaught-exception":
      return {
        level: "error",
        message: `${event.origin}: ${
          event.error instanceof Error
            ? (event.error.stack ??
              `${event.error.name}: ${event.error.message}`)
            : `a non-Error value of type ${typeof event.error}`
        }`,
        subject: NO_PLUGIN,
      };
    case "hub-chrome-renderer-gone":
      return {
        level: "error",
        message: `Hub Chrome renderer gone: ${event.reason} (exit code ${String(event.exitCode)})`,
        subject: NO_PLUGIN,
      };
    case "plugin-closed-abnormally":
      return {
        level: "error",
        message: `Plugin closed abnormally: ${describeCrash(event.crash)}`,
        subject: about(event.plugin),
      };
    default:
      return event satisfies never;
  }
}

function describeBackendExit(exit: BackendExit): string {
  return exit.kind === "code"
    ? `Backend exited with code ${String(exit.code)}`
    : `Backend exited on signal ${exit.signal}`;
}

function describeCrash(crash: PluginCrash): string {
  const cause = words(crash.cause);
  if (crash.cause === "stopped-responding") return cause;
  switch (crash.exit.kind) {
    case "plugin-ui-gone":
      return `${cause} (Plugin UI gone: ${crash.exit.reason}, exit code ${String(crash.exit.exitCode)})`;
    case "backend-exited":
      return `${cause} (${describeBackendExit(crash.exit.exit)})`;
    case "no-exit":
      return cause;
    default:
      return crash.exit satisfies never;
  }
}

function words(kebab: string): string {
  return kebab.replaceAll("-", " ");
}
