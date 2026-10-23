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
import { parseManifest, PluginId } from "@hawkeye-hub/plugin-format";
import { strToU8, zipSync } from "fflate";
import { beforeEach, expect, test } from "vitest";
import { FIRST_LAUNCH_SETTINGS } from "./hub-settings";
import { parseAbsolutePath, parseHubVersion, type AbsolutePath } from "./ids";
import { loadInstalledPlugins } from "./installed-plugins";
import { createJobQueue } from "./job-queue";
import { createLifecycle } from "./lifecycle";
import { createUpdater, type UpdateFailure } from "./plugin-update";
import type { RegistryCheck, RegistryFetch, RegistryPlugin } from "./registry";

let dataDir: AbsolutePath;

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-update-")));
});

const ID = PluginId.parse("seating-plan");

function manifestJson(version: string, overrides: Record<string, unknown>) {
  return {
    id: "seating-plan",
    version,
    hubApi: "^1.0.0",
    name: "Seating Plan",
    description: "Plan where students sit.",
    platforms: ["win32-x64", "darwin-arm64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "none" },
    assistant: { kind: "none" },
    ...overrides,
  };
}

function packageOf(version: string): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifestJson(version, {}))),
    "icon.svg": strToU8("<svg/>"),
    ui: { "index.html": strToU8(`<p>Seating ${version}</p>`) },
  });
}

const urlOf = (version: string) =>
  `https://registry.example/seating-plan-${version}.zip`;

/** The Registry's entry for `version`, installable unless `access` says otherwise. */
function offered(
  version: string,
  access: RegistryPlugin["access"] = { kind: "installable" },
): RegistryPlugin {
  const parsed = parseManifest(manifestJson(version, {}));
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  return {
    manifest: parsed.manifest,
    url: urlOf(version) as RegistryPlugin["url"],
    sha256: createHash("sha256")
      .update(packageOf(version))
      .digest("hex") as RegistryPlugin["sha256"],
    iconUrl:
      "https://registry.example/seating-plan.svg" as RegistryPlugin["iconUrl"],
    access,
  };
}

const listed = (...plugins: RegistryPlugin[]): RegistryCheck => ({
  kind: "listed",
  plugins,
});

/** A Registry serving every version's package, except those in `broken`, which answer 500. */
function registry(broken: string[] = []): RegistryFetch {
  return (url) => {
    const version = /seating-plan-(.+)\.zip$/.exec(url)?.[1];
    return Promise.resolve(
      version === undefined || broken.includes(version)
        ? new Response(null, { status: 500 })
        : new Response(packageOf(version), { status: 200 }),
    );
  };
}

/** A Hub with Seating Plan 1.0.0 installed, as the install steps leave it. */
function hubWith(fetch: RegistryFetch) {
  mkdirSync(join(dataDir, "seating-plan@1.0.0"));
  writeFileSync(
    join(dataDir, "seating-plan@1.0.0", "manifest.json"),
    JSON.stringify(manifestJson("1.0.0", {})),
  );
  writeFileSync(
    join(dataDir, "installed-plugins.json"),
    JSON.stringify([{ id: "seating-plan", version: "1.0.0" }]),
  );
  const lifecycle = createLifecycle({
    hubVersion: parseHubVersion("1.4.2"),
    systemLanguage: "en-HK",
    installed: loadInstalledPlugins(dataDir).loaded,
    storedAtStart: FIRST_LAUNCH_SETTINGS,
    keyedAtStart: new Set(),
    // Never saved here.
    save: () => new Set(),
    unknownTheme: () => {
      // Only Themes this Hub has.
    },
    // No Plugin with an Assistant is opened here.
    assistant: {
      context: () => {
        throw new Error("No Assistant here");
      },
      chat: () => {
        throw new Error("No Assistant here");
      },
      modelsAtStart: new Map(),
      saveModels: () => {
        throw new Error("No Assistant here");
      },
    },
    registry: {
      kind: "on",
      check: () => {
        // Checks are driven by the test.
      },
      install: () => {
        // No installs here.
      },
      uninstall: () => {
        // No uninstalls here.
      },
    },
  });
  const jobs = createJobQueue();
  const failures: UpdateFailure[] = [];
  const updater = createUpdater({
    dataDir,
    fetch,
    uv: {
      run: () => {
        throw new Error("uv ran for a UI-only Plugin");
      },
    },
    jobs,
    lifecycle,
    updateFailed: (failure) => failures.push(failure),
  });
  return {
    lifecycle,
    updater,
    failures,
    /** Settles once every job queued so far has. */
    idle: () => jobs.run(() => Promise.resolve()),
  };
}

function record(): unknown {
  return JSON.parse(
    readFileSync(join(dataDir, "installed-plugins.json"), "utf8"),
  );
}

/** The Plugin folders in the data folder. */
function versionFolders(): string[] {
  return readdirSync(dataDir)
    .filter((name) => name.startsWith("seating-plan@"))
    .sort();
}

test("a closed Plugin is updated at the next check: recorded, swapped in, and the old folder gone", async () => {
  const { lifecycle, updater } = hubWith(registry());

  await updater.registryChecked(listed(offered("1.1.0")));

  expect(record()).toEqual([{ id: "seating-plan", version: "1.1.0" }]);
  expect(versionFolders()).toEqual(["seating-plan@1.1.0"]);
  expect(lifecycle.installed(ID)).toEqual({
    folder: join(dataDir, "seating-plan@1.1.0"),
    manifest: offered("1.1.0").manifest,
  });
  expect(
    readFileSync(
      join(dataDir, "seating-plan@1.1.0", "ui", "index.html"),
      "utf8",
    ),
  ).toBe("<p>Seating 1.1.0</p>");
});

test("an open Plugin keeps its version, and has the new one once the Lifecycle has closed it", async () => {
  const { lifecycle, updater, idle } = hubWith(registry());
  lifecycle.open(ID);

  await updater.registryChecked(listed(offered("1.1.0")));

  expect(record()).toEqual([{ id: "seating-plan", version: "1.0.0" }]);
  expect(versionFolders()).toEqual([
    "seating-plan@1.0.0",
    "seating-plan@1.1.0",
  ]);
  expect(lifecycle.installed(ID).manifest.version).toBe("1.0.0");

  lifecycle.close(ID);
  await idle();
  expect(record()).toEqual([{ id: "seating-plan", version: "1.0.0" }]);

  lifecycle.closed(ID);
  await idle();
  expect(record()).toEqual([{ id: "seating-plan", version: "1.1.0" }]);
  expect(versionFolders()).toEqual(["seating-plan@1.1.0"]);
  expect(lifecycle.installed(ID).manifest.version).toBe("1.1.0");
  lifecycle.open(ID);
  expect(lifecycle.snapshot().open).toEqual(["seating-plan"]);
});

test("a failed update keeps the old version openable and is reported with its cause", async () => {
  const { lifecycle, updater, failures } = hubWith(registry(["1.1.0"]));

  await updater.registryChecked(listed(offered("1.1.0")));

  expect(failures).toEqual([
    { plugin: { id: "seating-plan", version: "1.1.0" }, cause: "download" },
  ]);
  expect(record()).toEqual([{ id: "seating-plan", version: "1.0.0" }]);
  expect(versionFolders()).toEqual(["seating-plan@1.0.0"]);
  lifecycle.open(ID);
  expect(lifecycle.installed(ID).manifest.version).toBe("1.0.0");
});

test("a failed update is tried again at the next check", async () => {
  let broken = ["1.1.0"];
  const { updater } = hubWith((url, init) => registry(broken)(url, init));
  await updater.registryChecked(listed(offered("1.1.0")));

  broken = [];
  await updater.registryChecked(listed(offered("1.1.0")));

  expect(record()).toEqual([{ id: "seating-plan", version: "1.1.0" }]);
});

test.each([
  ["not for this computer", "not-for-this-computer"],
  ["needing sign-in", "needs-sign-in"],
  ["needing a different Hub", "needs-different-hub"],
] as const)("a newer version %s is never taken", async (_name, reason) => {
  const { updater } = hubWith(registry());

  await updater.registryChecked(
    listed(offered("1.1.0", { kind: "blocked", reason })),
  );

  expect(record()).toEqual([{ id: "seating-plan", version: "1.0.0" }]);
  expect(versionFolders()).toEqual(["seating-plan@1.0.0"]);
});

test("an offered version no newer than the installed one is not taken", async () => {
  const { updater } = hubWith(registry());

  await updater.registryChecked(listed(offered("1.0.0")));
  await updater.registryChecked(listed(offered("0.9.0")));

  expect(record()).toEqual([{ id: "seating-plan", version: "1.0.0" }]);
  expect(versionFolders()).toEqual(["seating-plan@1.0.0"]);
});

test("a Plugin that is not installed is not updated", async () => {
  const { updater } = hubWith(registry());
  const parsed = parseManifest({
    ...manifestJson("2.0.0", {}),
    id: "class-timer",
  });
  if (parsed.kind === "invalid") throw new Error(parsed.reason);

  await updater.registryChecked(
    listed({ ...offered("2.0.0"), manifest: parsed.manifest }),
  );

  expect(readdirSync(dataDir).sort()).toEqual([
    "installed-plugins.json",
    "seating-plan@1.0.0",
  ]);
});

test("a newer version published before the swap discards the built one and builds the newest", async () => {
  const { lifecycle, updater, idle } = hubWith(registry());
  lifecycle.open(ID);
  await updater.registryChecked(listed(offered("1.1.0")));

  await updater.registryChecked(listed(offered("1.2.0")));

  expect(versionFolders()).toEqual([
    "seating-plan@1.0.0",
    "seating-plan@1.2.0",
  ]);
  lifecycle.close(ID);
  lifecycle.closed(ID);
  await idle();
  expect(record()).toEqual([{ id: "seating-plan", version: "1.2.0" }]);
  expect(versionFolders()).toEqual(["seating-plan@1.2.0"]);
});

test("a newer version arriving while one is still queued builds only the newest", async () => {
  const fetched: string[] = [];
  const { updater } = hubWith((url, init) => {
    fetched.push(url);
    return registry()(url, init);
  });

  await Promise.all([
    updater.registryChecked(listed(offered("1.1.0"))),
    updater.registryChecked(listed(offered("1.2.0"))),
  ]);

  expect(fetched).toEqual([urlOf("1.2.0")]);
  expect(record()).toEqual([{ id: "seating-plan", version: "1.2.0" }]);
  expect(versionFolders()).toEqual(["seating-plan@1.2.0"]);
});

test("a failed Registry check leaves installed Plugins alone", async () => {
  const { updater } = hubWith(registry());

  await updater.registryChecked({
    kind: "failed",
    failure: { kind: "no-response" },
  });

  expect(record()).toEqual([{ id: "seating-plan", version: "1.0.0" }]);
  expect(existsSync(join(dataDir, "seating-plan@1.0.0"))).toBe(true);
});
