// A Plugin's Backend process (ADRs 0003, 0008, 0009): spawned at open with its folders in place,
// sent `initialize`, relayed to its Plugin UI over a MessagePort, and sent `shutdown` at close,
// with its whole process tree killed if it has not exited after a grace period. Each abnormal end
// closes the Plugin with what went wrong.

import { spawn, type ChildProcess } from "node:child_process";
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
import { KEBAB_CASE } from "@hawkeye-hub/plugin-format";
import { parseRpcErrorReason, type AbsolutePath } from "./ids";
import type { InstalledPlugin } from "./installed-plugins";
import {
  killTreeNow,
  processTree,
  type ProcessTree,
  SPAWN_DETACHED,
  venvPython,
} from "./platform";

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

/** How long a Backend has to answer `initialize` before the Plugin fails to start (ADR 0009). */
export const INITIALIZE_TIMEOUT_MS = 10_000;

/** How long a Backend has to exit after `shutdown` before its process tree is killed (ADR 0003). */
export const SHUTDOWN_GRACE_MS = 5_000;

// Every Backend process still running, so a Hub crash can kill them all.
const running = new Set<ChildProcess>();

/**
 * Kills every running Backend's process tree, synchronously, as the Hub crashes. Best effort: the
 * stdin rule (PLUGIN_STANDARD.md §5.4) covers anything it misses.
 */
export function killBackendsNow(): void {
  for (const { pid } of running) {
    if (pid !== undefined) killTreeNow(pid);
  }
}

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
const PreloadText = z.string();
// An SDK Backend's error data (PLUGIN_STANDARD.md §5.3). A raw JSON-RPC Backend may send none.
const RpcData = z.object({ reason: z.string().regex(KEBAB_CASE) });

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
  const plugin = { id: manifest.id, version: manifest.version };
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
    detached: SPAWN_DETACHED,
  });
  diagnostics.recordHubEvent({ kind: "backend-spawned", plugin });
  running.add(child);
  let shuttingDown = false;
  let isInitialized = false;
  // The process tree, noted as `initialize` succeeds, while the Backend surely runs. Absent before.
  let tree: { processes: ProcessTree; noted: Promise<void> } | undefined;
  const noteTree = (pid: number) => {
    const processes = processTree(pid);
    return { processes, noted: processes.remember() };
  };

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
  // Node emits a child's `error` when it cannot be spawned, killed, sent an IPC message, or is
  // aborted (https://nodejs.org/docs/latest-v22.x/api/child_process.html#event-error). The Hub
  // never kills it through Node, gives it no IPC channel and no abort signal, so only a failed
  // spawn, such as a missing venv, can happen: the Plugin cannot run. Its close follows, but a
  // Backend that never ran has no exit worth reporting. Anything else is a Hub bug, and throws.
  child.once("error", (error) => {
    if (child.pid !== undefined) throw error;
    closePlugin({ cause: "failed-to-start", exit: { kind: "no-exit" } });
  });
  // A write to a Backend that has already exited fails: EPIPE on macOS
  // (https://nodejs.org/docs/latest-v22.x/api/errors.html#common-system-errors), EOF on Windows
  // (probed on Node 22.17, writing to a child as it exits). The exit itself is the close
  // listener's to handle, so those are dropped; any other stdin error is a Hub bug, and throws.
  child.stdin.on("error", (error) => {
    if (!(
      "code" in error &&
      (error.code === "EPIPE" || error.code === "EOF")
    )) {
      throw error;
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    pluginSession.recordStderr(chunk);
  });

  const send = (line: string): void => {
    child.stdin.write(`${line}\n`);
  };

  const initialized = Promise.withResolvers<undefined>();
  // The relayed requests still waiting for an answer, by id: an error answer is logged with its method.
  const pending = new Map<number | string, string>();
  // The Plugin preload's port, once relayed. Until then, what the Backend sends waits here: it may
  // notify as soon as it has answered `initialize`, before the port is handed over.
  let toPreload:
    | { kind: "waiting"; queued: z.infer<typeof FromBackend>[] }
    | { kind: "relayed"; port: MessagePortMain } = {
    kind: "waiting",
    queued: [],
  };
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
          // A process that answered was spawned, so it has an id.
          if (child.pid === undefined) {
            throw new Error("A Backend answered with no process id");
          }
          tree = noteTree(child.pid);
          initialized.resolve(undefined);
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
      if (toPreload.kind === "waiting") toPreload.queued.push(message);
      else toPreload.port.postMessage(message);
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
    initialized: initialized.promise,
    relay(port) {
      if (toPreload.kind === "relayed") {
        throw new Error("A Backend is relayed to one port per open");
      }
      for (const message of toPreload.queued) port.postMessage(message);
      toPreload = { kind: "relayed", port };
      // The preload sends each message as JSON text, serialised from the page's values. One that
      // is not a request or notification is the Plugin's mistake: it breaks the protocol, and the
      // Plugin closes.
      port.on("message", ({ data }: { data: unknown }) => {
        const text = PreloadText.safeParse(data);
        const message = text.success
          ? FromPreload.safeParse(parseJson(text.data))
          : text;
        if (!text.success || !message.success) {
          violated("ui-not-json-rpc");
          return;
        }
        if ("id" in message.data) {
          pending.set(message.data.id, message.data.method);
        }
        send(text.data);
      });
      port.start();
    },
    async shutdown() {
      shuttingDown = true;
      clearTimeout(initializeTimeout);
      if (toPreload.kind === "relayed") toPreload.port.close();
      const { pid } = child;
      // ponytail: what a Backend that already exited left behind is not killed. Kill the tree noted
      // at `initialize` here too if Backends that crash leaving children turn up.
      if (!running.has(child) || pid === undefined) {
        await exited;
        return;
      }
      // The tree is first noted while the Backend surely runs, before `shutdown`: on Windows what it
      // leaves behind is found only through that note. It was noted at `initialize`, so this waits
      // only when the Plugin closes while initializing, or before that note is done.
      const { processes, noted } = tree ?? noteTree(pid);
      await noted;
      send(JSON.stringify({ jsonrpc: "2.0", method: "shutdown" }));
      // Noted again alongside the grace period, not before `shutdown`, as the Windows query takes a
      // while: through what was noted, it finds what the Backend launched since, even once the
      // Backend has exited.
      const renoted = processes.remember();
      // Until the Backend exits, or the grace period runs out.
      const stopped = new Promise<void>((resolve) => {
        const graceTimer = setTimeout(resolve, SHUTDOWN_GRACE_MS);
        void exited.then(() => {
          clearTimeout(graceTimer);
          resolve();
        });
      });
      await Promise.all([stopped, renoted]);
      // Whether the Backend exited by itself or the grace period ran out, nothing it launched
      // outlives it (spec #44 story 42).
      await processes.kill();
      await exited;
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
