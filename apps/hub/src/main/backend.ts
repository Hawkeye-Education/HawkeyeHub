// A Plugin's Backend process (ADRs 0003, 0008, 0009): spawned at open with its folders in place,
// sent `initialize`, relayed to its Plugin UI over a MessagePort, and sent `shutdown` at close,
// with its whole process tree killed if it has not exited after a grace period. Each abnormal end
// closes the Plugin with what went wrong.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { MessagePortMain } from "electron";
import { z } from "zod";
import type {
  BackendExit,
  Diagnostics,
  PluginCrash,
  PluginSession,
  ProtocolViolation,
} from "./diagnostics";
import { HUB_API_VERSION } from "./hub-api-version";
import {
  KEBAB_CASE,
  parsePluginId,
  parsePluginVersion,
  parseRpcErrorReason,
  type AbsolutePath,
} from "./ids";
import type { InstalledPlugin } from "./installed-plugins";

export interface Backend {
  /** Resolves once `initialize` has succeeded; never, if it does not (the Plugin then closes). */
  initialized: Promise<void>;
  /** Relays JSON-RPC between `port` (the Plugin preload's) and the Backend. Once per open. */
  relay(port: MessagePortMain): void;
  /**
   * Sends `shutdown`, once the Plugin UI is gone, and kills the process tree if it has not exited
   * after `SHUTDOWN_GRACE_MS`. Resolves once the process has exited, and any kill has finished.
   */
  shutdown(): Promise<void>;
}

/** How long a Backend has to exit after `shutdown` before its process tree is killed (ADR 0003). */
export const SHUTDOWN_GRACE_MS = 5_000;

// Every Backend process still running, so a Hub crash can kill them all.
const running = new Set<ChildProcess>();

/**
 * Kills a Backend and every process it launched: taskkill /T on Windows, which walks the live
 * process tree (the venv's python.exe is a launcher with the real interpreter as its child), and
 * the process group on macOS, where the Backend is spawned detached as its group's leader.
 * Resolves once the whole tree is gone: the Backend itself can exit before taskkill has reached
 * its children.
 */
function killTree(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    killTreeNow(pid);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    spawn("taskkill", taskkillArgs(pid), TASKKILL_OPTIONS).once("exit", () => {
      resolve();
    });
  });
}

// taskkill reports a tree already gone by its exit code, which is not needed here.
const TASKKILL_OPTIONS = { stdio: "ignore", windowsHide: true } as const;
function taskkillArgs(pid: number): string[] {
  return ["/pid", String(pid), "/T", "/F"];
}

/** `killTree`, waiting for taskkill, for a Hub that is about to exit. */
function killTreeNow(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", taskkillArgs(pid), TASKKILL_OPTIONS);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    // The whole group has already exited: there is nothing left to kill.
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

/**
 * Kills every running Backend's process tree, synchronously, as the Hub crashes. Best effort: the
 * stdin rule (PLUGIN_STANDARD.md §5.4) covers anything it misses.
 */
export function killBackendsNow(): void {
  for (const { pid } of running) {
    if (pid !== undefined) killTreeNow(pid);
  }
}

/** How long a Backend has to answer `initialize` before the Plugin fails to start (ADR 0009). */
export const INITIALIZE_TIMEOUT_MS = 10_000;

// The Hub's own request id. The Plugin preload numbers its requests, so the two never meet.
const INITIALIZE_ID = "hub-initialize";

const Id = z.union([z.number(), z.string()]);
const RpcErrorObject = z.object({
  code: z.number(),
  message: z.string(),
  // JSON-RPC makes `data` optional; SDK Backends send `{reason}` (PLUGIN_STANDARD.md §5.3).
  data: z.unknown(),
});
// What a Backend may write to stdout: responses and notifications. A request is not among them:
// only the Plugin UI sends requests.
const FromBackend = z.union([
  z.strictObject({ jsonrpc: z.literal("2.0"), id: Id, result: z.json() }),
  z.strictObject({ jsonrpc: z.literal("2.0"), id: Id, error: RpcErrorObject }),
  z.strictObject({
    jsonrpc: z.literal("2.0"),
    method: z.string(),
    // JSON-RPC makes a notification's params optional.
    params: z.json().optional(),
  }),
]);
// A request on the Backend's stdout: a protocol violation of its own kind.
const Request = z.object({
  jsonrpc: z.literal("2.0"),
  id: Id,
  method: z.string(),
});
// What the Plugin preload sends, as JSON text: only the parts the relay needs to read.
const FromPreload = z
  .object({ id: z.number(), method: z.string() })
  .or(z.object({ method: z.string() }));
// An SDK Backend's error data (PLUGIN_STANDARD.md §5.3). A raw JSON-RPC Backend may send none.
const RpcData = z.object({ reason: z.string().regex(KEBAB_CASE) });

/** The venv's Python, as install builds it (ADR 0003). */
function venvPython(backendDir: string): string {
  return process.platform === "win32"
    ? join(backendDir, ".venv", "Scripts", "python.exe")
    : join(backendDir, ".venv", "bin", "python");
}

/** The Hub's environment minus the locale: a Backend never relies on it (PLUGIN_STANDARD.md §5.5). */
function backendEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== "LANG" && !name.startsWith("LC_"),
    ),
  );
}

export function startBackend(
  { folder, manifest }: InstalledPlugin,
  hubDataDir: AbsolutePath,
  diagnostics: Diagnostics,
  pluginSession: PluginSession,
  /** Closes the whole Plugin, while it is still open: the Backend broke or failed to start. */
  closePlugin: (crash: PluginCrash) => void,
): Backend {
  const plugin = {
    id: parsePluginId(manifest.id),
    version: parsePluginVersion(manifest.version),
  };
  // Keyed by id, never version, so they survive updates (ADR 0008).
  const dataDir = join(hubDataDir, "plugin-data", manifest.id);
  const stores = Object.fromEntries(
    manifest.stores.map((name) => [name, join(hubDataDir, "stores", name)]),
  );
  for (const dir of [dataDir, ...Object.values(stores)]) {
    mkdirSync(dir, { recursive: true });
  }

  const backendDir = join(folder, "backend");
  const child = spawn(venvPython(backendDir), ["main.py"], {
    cwd: backendDir,
    env: backendEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // Its own process group on macOS, so the whole tree can be killed. Not on Windows, where
    // detached opens a console; taskkill /T finds the tree there.
    detached: process.platform === "darwin",
  });
  diagnostics.recordHubEvent({ kind: "backend-spawned", plugin });
  running.add(child);
  let shuttingDown = false;
  let isInitialized = false;
  // Set while the grace period after `shutdown` runs. Null before `shutdown`, and once it ends.
  let graceKill: NodeJS.Timeout | null = null;

  const initializeTimeout = setTimeout(() => {
    diagnostics.recordHubEvent({
      kind: "initialize-failed",
      plugin,
      failure: "timed-out",
    });
    closePlugin({ cause: "failed-to-start", exit: { kind: "no-exit" } });
  }, INITIALIZE_TIMEOUT_MS);

  const exited = new Promise<void>((resolve) => {
    child.once("close", (code, signal) => {
      clearTimeout(initializeTimeout);
      running.delete(child);
      if (graceKill !== null) clearTimeout(graceKill);
      const exit: BackendExit =
        code !== null
          ? { kind: "code", code }
          : { kind: "signal", signal: signalOf(signal) };
      diagnostics.recordHubEvent({ kind: "backend-exited", plugin, exit });
      if (!shuttingDown) {
        closePlugin({
          cause: isInitialized ? "crashed" : "failed-to-start",
          exit: { kind: "backend-exited", exit },
        });
      }
      resolve();
    });
  });
  // The Backend could not be spawned at all, such as a missing venv: the Plugin cannot run. Its
  // close follows, but a Backend that never ran has no exit worth reporting.
  child.once("error", () => {
    if (child.pid === undefined) {
      closePlugin({ cause: "failed-to-start", exit: { kind: "no-exit" } });
    }
  });
  // A write to a Backend that has already exited fails with EPIPE. That is not a Hub error: the
  // exit itself is handled by the close listener above.
  child.stdin.on("error", () => undefined);
  child.stderr.on("data", (chunk: Buffer) => {
    pluginSession.recordStderr(chunk);
  });

  const send = (line: string): void => {
    child.stdin.write(`${line}\n`);
  };

  let resolveInitialized: () => void = () => undefined;
  const initialized = new Promise<void>((resolve) => {
    resolveInitialized = resolve;
  });
  // The relayed requests still waiting for an answer, by id: an error answer is logged with its method.
  const pending = new Map<number | string, string>();
  let toPreload: MessagePortMain | null = null;
  const violated = (violation: ProtocolViolation): void => {
    closePlugin({
      cause: "crashed",
      exit: { kind: "protocol-violation", violation },
    });
  };

  createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
    "line",
    (line) => {
      const json = parseJson(line);
      const parsed = FromBackend.safeParse(json);
      // A line that is not a response or notification breaks the protocol: the Plugin closes.
      if (!parsed.success) {
        violated(Request.safeParse(json).success ? "request" : "not-json-rpc");
        return;
      }
      const message = parsed.data;
      if ("id" in message && message.id === INITIALIZE_ID) {
        clearTimeout(initializeTimeout);
        if ("error" in message) {
          diagnostics.recordHubEvent({
            kind: "initialize-failed",
            plugin,
            failure: "rejected",
          });
          closePlugin({ cause: "failed-to-start", exit: { kind: "no-exit" } });
        } else {
          isInitialized = true;
          resolveInitialized();
        }
        return;
      }
      if ("id" in message) {
        const method = pending.get(message.id);
        // An answer to a request nobody sent breaks the protocol too.
        if (method === undefined) {
          violated("unknown-response");
          return;
        }
        pending.delete(message.id);
        if ("error" in message) {
          const data = RpcData.safeParse(message.error.data);
          pluginSession.recordRpcError({
            method,
            reason: data.success ? parseRpcErrorReason(data.data.reason) : null,
            message: message.error.message,
          });
        }
      }
      toPreload?.postMessage(message);
    },
  );

  send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: INITIALIZE_ID,
      method: "initialize",
      params: { dataDir, stores, hubApi: HUB_API_VERSION },
    }),
  );

  return {
    initialized,
    relay(port) {
      toPreload = port;
      // The preload sends each message as JSON text, already serialised from the page's values.
      port.on("message", ({ data }) => {
        if (typeof data !== "string") {
          throw new Error("The Plugin preload sends JSON text");
        }
        const message = FromPreload.parse(JSON.parse(data));
        if ("id" in message) pending.set(message.id, message.method);
        send(data);
      });
      port.start();
    },
    shutdown() {
      shuttingDown = true;
      clearTimeout(initializeTimeout);
      toPreload?.close();
      send(JSON.stringify({ jsonrpc: "2.0", method: "shutdown" }));
      // Resolved at once unless the grace period runs out and the tree is killed.
      let killed = Promise.resolve();
      // A Backend that exited on its own, or never spawned, has no tree left to kill.
      if (running.has(child) && child.pid !== undefined) {
        const { pid } = child;
        graceKill = setTimeout(() => {
          killed = killTree(pid);
        }, SHUTDOWN_GRACE_MS);
      }
      return exited.then(() => killed);
    },
  };
}

/** A line that is not JSON at all, as `undefined`, which no message schema accepts. */
function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function signalOf(signal: NodeJS.Signals | null): NodeJS.Signals {
  // Node gives a close either an exit code or the signal that ended the process.
  if (signal === null)
    throw new Error("A Backend closed with neither code nor signal");
  return signal;
}
