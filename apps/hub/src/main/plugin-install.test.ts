import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@hawkeye-hub/plugin-format";
import { strToU8, zipSync, type Zippable } from "fflate";
import { beforeEach, expect, test } from "vitest";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import { installPlugin } from "./plugin-install";
import type { Uv, UvRun } from "./uv";
import type { RegistryFetch, RegistryPlugin } from "./registry";

let dataDir: AbsolutePath;

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-install-")));
});

const PACKAGE_URL = "https://registry.example/seating-plan-1.2.0.zip";

function manifestJson(overrides: Record<string, unknown> = {}) {
  return {
    id: "seating-plan",
    version: "1.2.0",
    hubApi: "^1.0.0",
    name: "Seating Plan",
    description: "Plan where students sit.",
    platforms: ["win32-x64", "darwin-arm64"],
    identity: { kind: "none" },
    stores: ["timetable", "rooms"],
    backend: { kind: "none" },
    assistant: { kind: "none" },
    ...overrides,
  };
}

/** A Plugin Package: a zip of a UI-only Plugin, with `extra` files or overrides. */
function pluginPackage(
  manifest: Record<string, unknown> = manifestJson(),
  extra: Zippable = {},
): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "icon.svg": strToU8("<svg/>"),
    ui: { "index.html": strToU8("<p>Seating</p>") },
    ...extra,
  });
}

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The Registry's entry for `bytes`, at its true checksum unless one is given. */
function offered(
  bytes: Uint8Array,
  sha256 = sha256Of(bytes),
  manifest: Record<string, unknown> = manifestJson(),
): RegistryPlugin {
  const parsed = parseManifest(manifest);
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  return {
    manifest: parsed.manifest,
    url: PACKAGE_URL as RegistryPlugin["url"],
    sha256: sha256 as RegistryPlugin["sha256"],
    iconUrl:
      "https://registry.example/seating-plan.svg" as RegistryPlugin["iconUrl"],
    access: { kind: "installable" },
  };
}

/** A Registry serving `bytes` at PACKAGE_URL only. */
function serving(bytes: Uint8Array, status = 200): RegistryFetch {
  return (url) =>
    Promise.resolve(
      url === PACKAGE_URL
        ? new Response(bytes, { status })
        : new Response(null, { status: 404 }),
    );
}

/** uv for a UI-only Plugin: never run. */
const uvNeverRun: Uv = {
  run: () => {
    throw new Error("uv ran for a UI-only Plugin");
  },
};

/** A uv that records each run, answering `answer` to `uv sync` and success to the rest. */
function fakeUv(answer: UvRun = { kind: "succeeded" }) {
  const runs: { args: readonly string[]; cwd: string }[] = [];
  const uv: Uv = {
    run: (args, cwd) => {
      runs.push({ args, cwd });
      return Promise.resolve(
        args[0] === "sync" ? answer : { kind: "succeeded" },
      );
    },
  };
  return { uv, runs };
}

const python = manifestJson({ backend: { kind: "python", python: "3.12" } });

/** A Python-Backend Plugin Package: its `backend/` holds a uv project. */
function pythonPackage(): Uint8Array {
  return pluginPackage(python, {
    backend: {
      "main.py": strToU8("print('hi')"),
      "pyproject.toml": strToU8("[project]"),
      "uv.lock": strToU8("version = 1"),
    },
  });
}

function record(): unknown {
  return JSON.parse(
    readFileSync(join(dataDir, "installed-plugins.json"), "utf8"),
  );
}

/** What is in the data folder, by name. */
function onDisk(): string[] {
  return readdirSync(dataDir).sort();
}

test("installing unpacks the package into <id>@<version>, records it and makes its data and store folders", async () => {
  writeFileSync(
    join(dataDir, "installed-plugins.json"),
    JSON.stringify([{ id: "class-timer", version: "0.1.0" }]),
  );
  const bytes = pluginPackage();

  const outcome = await installPlugin(
    { dataDir, uv: uvNeverRun, fetch: serving(bytes) },
    offered(bytes),
  );

  const folder = join(dataDir, "seating-plan@1.2.0");
  expect(outcome).toEqual({
    kind: "installed",
    plugin: { folder, manifest: offered(bytes).manifest },
  });
  expect(readFileSync(join(folder, "ui", "index.html"), "utf8")).toBe(
    "<p>Seating</p>",
  );
  expect(record()).toEqual([
    { id: "class-timer", version: "0.1.0" },
    { id: "seating-plan", version: "1.2.0" },
  ]);
  expect(existsSync(join(dataDir, "plugin-data", "seating-plan"))).toBe(true);
  expect(readdirSync(join(dataDir, "stores")).sort()).toEqual([
    "rooms",
    "timetable",
  ]);
  expect(onDisk()).toEqual([
    "installed-plugins.json",
    "plugin-data",
    "seating-plan@1.2.0",
    "stores",
  ]);
});

test("a fresh Hub with no record yet records the one Plugin", async () => {
  const bytes = pluginPackage();

  await installPlugin(
    { dataDir, uv: uvNeverRun, fetch: serving(bytes) },
    offered(bytes),
  );

  expect(record()).toEqual([{ id: "seating-plan", version: "1.2.0" }]);
});

test("a package that does not match its checksum fails with checksum and leaves nothing", async () => {
  const bytes = pluginPackage();

  const outcome = await installPlugin(
    { dataDir, uv: uvNeverRun, fetch: serving(bytes) },
    offered(bytes, "0".repeat(64)),
  );

  expect(outcome).toEqual({ kind: "failed", cause: "checksum" });
  expect(onDisk()).toEqual([]);
});

test("a package the Registry answers with an error status fails with download and leaves nothing", async () => {
  const bytes = pluginPackage();

  const outcome = await installPlugin(
    { dataDir, uv: uvNeverRun, fetch: serving(bytes, 500) },
    offered(bytes),
  );

  expect(outcome).toEqual({ kind: "failed", cause: "download" });
  expect(onDisk()).toEqual([]);
});

test("no response fails with download and leaves nothing", async () => {
  const bytes = pluginPackage();

  const outcome = await installPlugin(
    {
      dataDir,
      uv: uvNeverRun,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    },
    offered(bytes),
  );

  expect(outcome).toEqual({ kind: "failed", cause: "download" });
  expect(onDisk()).toEqual([]);
});

test.each([
  ["a file that is not a zip", strToU8("not a zip")],
  [
    "a zip with an entry outside its folder",
    pluginPackage(manifestJson(), { "../escaped.txt": strToU8("x") }),
  ],
  [
    "a zip whose Manifest is another Plugin's",
    pluginPackage(manifestJson({ id: "class-timer" })),
  ],
  [
    "a zip whose Manifest is another version",
    pluginPackage(manifestJson({ version: "1.3.0" })),
  ],
  ["a zip whose Manifest is invalid", pluginPackage({ id: "seating-plan" })],
])("%s fails with unpack and leaves nothing", async (_name, bytes) => {
  const outcome = await installPlugin(
    { dataDir, uv: uvNeverRun, fetch: serving(bytes) },
    offered(bytes),
  );

  expect(outcome).toEqual({ kind: "failed", cause: "unpack" });
  expect(onDisk()).toEqual([]);
  expect(existsSync(join(dataDir, "..", "escaped.txt"))).toBe(false);
});

test("a Python Backend's venv is built in backend/ inside the partial folder, with uv's managed Python", async () => {
  const bytes = pythonPackage();
  const { uv, runs } = fakeUv();

  const outcome = await installPlugin(
    { dataDir, uv, fetch: serving(bytes) },
    offered(bytes, sha256Of(bytes), python),
  );

  expect(outcome.kind).toBe("installed");
  const backend = join(dataDir, "seating-plan@1.2.0.partial", "backend");
  expect(runs).toEqual([
    {
      args: ["python", "install", "--no-bin", "--no-registry", "3.12"],
      cwd: backend,
    },
    {
      args: [
        "sync",
        "--frozen",
        "--no-dev",
        "--no-editable",
        "--python",
        "3.12",
      ],
      cwd: backend,
    },
  ]);
  expect(
    existsSync(join(dataDir, "seating-plan@1.2.0", "backend", "main.py")),
  ).toBe(true);
});

test("a venv that fails to build fails with environment and uv's last 50 lines of stderr, and leaves nothing, not even uv", async () => {
  const bytes = pythonPackage();
  // What uv itself left before failing, with no other Python-Backend Plugin installed.
  mkdirSync(
    join(dataDir, "uv", "python", "cpython-3.12.7-windows-x86_64-none"),
    {
      recursive: true,
    },
  );
  const lines = Array.from({ length: 60 }, (_, i) => `line ${String(i + 1)}`);
  const { uv } = fakeUv({
    kind: "failed",
    stderr: lines.join("\n") + "\n",
  });

  const outcome = await installPlugin(
    { dataDir, uv, fetch: serving(bytes) },
    offered(bytes, sha256Of(bytes), python),
  );

  expect(outcome).toEqual({
    kind: "failed",
    cause: "environment",
    stderr: lines.slice(10).join("\n"),
  });
  expect(onDisk()).toEqual([]);
});
