// A Plugin's Backend process (ADRs 0003, 0008, 0009): spawned at open with its folders in place,
// sent `initialize`, relayed to its Plugin UI over a MessagePort, and sent `shutdown` at close.
// The grace-period kill and the crash records for its abnormal ends arrive with later tickets.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { MessagePortMain } from "electron";
import { z } from "zod";
import type { BackendExit, Diagnostics, PluginSession } from "./diagnostics";
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
  /** Sends `shutdown`, once the Plugin UI is gone. Resolves once the process has exited. */
  shutdown(): Promise<void>;
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
  closePlugin: () => void,
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
  let shuttingDown = false;

  const exited = new Promise<void>((resolve) => {
    child.once("close", (code, signal) => {
      const exit: BackendExit =
        code !== null
          ? { kind: "code", code }
          : { kind: "signal", signal: signalOf(signal) };
      diagnostics.recordHubEvent({ kind: "backend-exited", plugin, exit });
      if (!shuttingDown) closePlugin();
      resolve();
    });
  });
  // The Backend could not be spawned at all, such as a missing venv: the Plugin cannot run.
  child.once("error", () => {
    if (child.pid === undefined) closePlugin();
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

  createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
    "line",
    (line) => {
      const parsed = FromBackend.safeParse(parseJson(line));
      // A line that is not a response or notification breaks the protocol: the Plugin closes.
      // Its crash record arrives with #53.
      if (!parsed.success) {
        closePlugin();
        return;
      }
      const message = parsed.data;
      if ("id" in message && message.id === INITIALIZE_ID) {
        if ("error" in message) closePlugin();
        else resolveInitialized();
        return;
      }
      if ("id" in message) {
        const method = pending.get(message.id);
        // An answer to a request nobody sent breaks the protocol too.
        if (method === undefined) {
          closePlugin();
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
      toPreload?.close();
      send(JSON.stringify({ jsonrpc: "2.0", method: "shutdown" }));
      return exited;
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
