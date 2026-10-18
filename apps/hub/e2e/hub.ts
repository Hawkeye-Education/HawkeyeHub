// The smoke harness: every test gets a fresh HAWKEYE_HUB_DATA_DIR and the built Hub running in it.

import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron,
  test as base,
  expect,
  type ElectronApplication,
} from "@playwright/test";

// The package directory, so Electron reads package.json's `main` and `productName`.
export const HUB_DIR = join(import.meta.dirname, "..");

/** The environment a Hub runs in: this one plus its data folder. */
// Inferred: _electron.launch's env type is narrower than NodeJS.ProcessEnv but accepts the spread.
export function hubEnv(dataDir: string) {
  return { ...process.env, HAWKEYE_HUB_DATA_DIR: dataDir };
}

export function launchHub(dataDir: string): Promise<ElectronApplication> {
  // `env` replaces the environment rather than adding to it.
  return _electron.launch({ args: [HUB_DIR], env: hubEnv(dataDir) });
}

export const test = base.extend<{ dataDir: string; hub: ElectronApplication }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured.
  dataDir: async ({}, use, testInfo) => {
    // Canonical, because the Hub resolves symlinks in its logs path: macOS's /var is /private/var.
    const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "hawkeye-hub-")));
    await use(dataDir);
    // The data folder goes with the CI runner, and hub.log is what explains a failure. A Hub that
    // never got as far as opening Diagnostics has none.
    const hubLog = join(dataDir, "logs", "hub.log");
    if (testInfo.status !== testInfo.expectedStatus && existsSync(hubLog)) {
      await testInfo.attach("hub.log", { path: hubLog });
    }
  },
  hub: async ({ dataDir }, use) => {
    const hub = await launchHub(dataDir);
    // Taken now: once the Hub has quit, `hub.process()` throws.
    const hubProcess = hub.process();
    await use(hub);
    // A test may already have quit the Hub itself.
    if (hubProcess.exitCode === null) {
      await hub.close();
    }
  },
});

/** Resolves with the Hub's exit code once it quits, or null if a signal ended it. */
export function exitCodeOf(hub: ElectronApplication): Promise<number | null> {
  return new Promise((resolve) => {
    hub.process().once("exit", resolve);
  });
}

export function hubLogLines(dataDir: string): unknown[] {
  return readFileSync(join(dataDir, "logs", "hub.log"), "utf8")
    .trimEnd()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
}

export function lifecycleLine(message: string): unknown {
  return {
    time: expect.any(String),
    source: "hub",
    level: "info",
    message,
    pluginId: null,
    pluginVersion: null,
  };
}

export { expect };
