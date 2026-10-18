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

export type PluginCrashCause =
  "crashed" | "failed-to-start" | "stopped-responding";

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
      cause: PluginCrashCause;
    };

export type HubLevel = "info" | "warn" | "error";

// A line is about one Plugin, or about none: the null pair is a real state, not a missing value.
type LineSubject =
  | { pluginId: PluginId; pluginVersion: PluginVersion }
  | { pluginId: null; pluginVersion: null };

export type HubLogLine = {
  time: string;
  source: "hub";
  level: HubLevel;
  message: string;
} & LineSubject;

export interface Diagnostics {
  recordHubEvent(event: HubEvent): void;
}

export function openDiagnostics(
  logsDir: string,
  now: () => Date,
  maxLogFileBytes: number = MAX_LOG_FILE_BYTES,
): Diagnostics {
  mkdirSync(logsDir, { recursive: true });

  function append(relativePath: string, line: HubLogLine): void {
    const path = join(logsDir, relativePath);
    const text = JSON.stringify(line) + "\n";
    const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
    if (size > 0 && size + Buffer.byteLength(text) > maxLogFileBytes) {
      renameSync(path, `${path}.1`);
    }
    appendFileSync(path, text);
  }

  return {
    recordHubEvent(event) {
      const { level, message, subject } = describe(event);
      append("hub.log", {
        time: now().toISOString(),
        source: "hub",
        level,
        message,
        ...subject,
      });
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
        message:
          event.exit.kind === "code"
            ? `Backend exited with code ${String(event.exit.code)}`
            : `Backend exited on signal ${event.exit.signal}`,
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
        message: `Plugin closed abnormally: ${words(event.cause)}`,
        subject: about(event.plugin),
      };
    default:
      return event satisfies never;
  }
}

function words(kebab: string): string {
  return kebab.replaceAll("-", " ");
}
