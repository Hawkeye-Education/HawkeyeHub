import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { parseManifest } from "@hawkeye-hub/plugin-format";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SHUTDOWN_GRACE_MS, startBackend } from "./backend";
import type { Diagnostics, PluginSession } from "./diagnostics";
import { parseAbsolutePath } from "./ids";

// The Backend process, as the Hub sees it: stdin lines it was sent, and stdout it answers on.
const child = vi.hoisted((): { current: unknown } => ({ current: undefined }));
vi.mock("node:child_process", () => ({
  spawn: () => child.current,
}));

// The process tree: noting it takes `REMEMBER_MS`, as the PowerShell query does on Windows.
const REMEMBER_MS = 2_000;
const tree = vi.hoisted(() => ({ killedAt: [] as number[] }));
vi.mock("./platform", () => ({
  SPAWN_DETACHED: false,
  venvPython: () => "python",
  killTreeNow: () => undefined,
  processTree: () => ({
    remember: () =>
      new Promise<void>((resolve) => setTimeout(resolve, REMEMBER_MS)),
    // The Backend ignores `shutdown`: only the kill ends it.
    kill: () => {
      tree.killedAt.push(Date.now());
      (child.current as EventEmitter).emit("close", null, "SIGKILL");
      return Promise.resolve();
    },
  }),
}));

class FakeChild extends EventEmitter {
  pid = 4321;
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  sent: string[] = [];
  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.sent.push(...chunk.toString().split("\n").filter(Boolean));
    });
  }
  answer(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

const noop = (): void => undefined;
const session: PluginSession = {
  recordConsoleMessage: noop,
  recordStderr: noop,
  recordRpcError: noop,
  recordCrash: noop,
  end: noop,
};
const diagnostics = { recordHubEvent: noop } as unknown as Diagnostics;

function installed() {
  const parsed = parseManifest({
    id: "echo-backend",
    version: "1.0.0",
    hubApi: "^1.0.0",
    name: "Echo",
    description: "A fixture.",
    platforms: ["win32-x64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "python", python: "3.12" },
    assistant: { kind: "none" },
  });
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  return {
    folder: parseAbsolutePath("/plugins/echo-backend@1.0.0"),
    manifest: parsed.manifest,
  };
}

let fake: FakeChild;
beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeChild();
  child.current = fake;
  tree.killedAt = [];
});
afterEach(() => {
  vi.useRealTimers();
});

async function initializedBackend() {
  const backend = startBackend(
    installed(),
    parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-data-"))),
    diagnostics,
    session,
    noop,
    "installed",
  );
  await vi.advanceTimersByTimeAsync(0);
  fake.answer({ jsonrpc: "2.0", id: "hub-initialize", result: {} });
  await backend.initialized;
  // Past the tree noted at `initialize`.
  await vi.advanceTimersByTimeAsync(REMEMBER_MS);
  return backend;
}

test("shutdown is sent at once, without waiting for the process tree to be noted", async () => {
  const backend = await initializedBackend();

  void backend.shutdown();
  await vi.advanceTimersByTimeAsync(0);

  expect(fake.sent.at(-1)).toBe('{"jsonrpc":"2.0","method":"shutdown"}');
});

test("a Backend that ignores shutdown is killed after the grace period, not the grace period plus the query", async () => {
  const backend = await initializedBackend();
  const closedAt = Date.now();

  const done = backend.shutdown();
  await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS + REMEMBER_MS);
  await done;

  expect(tree.killedAt).toEqual([closedAt + SHUTDOWN_GRACE_MS]);
});
