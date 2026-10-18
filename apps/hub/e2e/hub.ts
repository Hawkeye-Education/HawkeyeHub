// The smoke harness: every test gets a fresh HAWKEYE_HUB_DATA_DIR and the built Hub running in it.

import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
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

export function launchHub(dataDir: string): Promise<ElectronApplication> {
  return _electron.launch({
    args: [HUB_DIR],
    // `env` replaces the environment rather than adding to it.
    env: { ...process.env, HAWKEYE_HUB_DATA_DIR: dataDir },
  });
}

export const test = base.extend<{ dataDir: string; hub: ElectronApplication }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured.
  dataDir: async ({}, use) => {
    // Canonical, because the Hub resolves symlinks in its logs path: macOS's /var is /private/var.
    await use(realpathSync(mkdtempSync(join(tmpdir(), "hawkeye-hub-"))));
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
