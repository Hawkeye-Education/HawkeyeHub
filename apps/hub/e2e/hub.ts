// The smoke harness: every test gets a fresh HAWKEYE_HUB_DATA_DIR and the built Hub running in it.

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron,
  test as base,
  expect,
  type ElectronApplication,
  type Page,
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

const FIXTURE_PLUGINS = join(import.meta.dirname, "fixtures", "plugins");

/** One entry to write in the record of installed Plugins, and the fixture its folder copies. */
export interface FixtureInstall {
  /** A folder of `e2e/fixtures/plugins`. */
  fixture: string;
  id: string;
  version: string;
}

/**
 * Installs Plugins into a data folder before the Hub starts, as install will: copies each fixture
 * to `<id>@<version>` and writes the record. The entry need not agree with the fixture's Manifest.
 */
export function installFixturePlugins(
  dataDir: string,
  installs: FixtureInstall[],
): void {
  for (const { fixture, id, version } of installs) {
    cpSync(join(FIXTURE_PLUGINS, fixture), join(dataDir, `${id}@${version}`), {
      recursive: true,
    });
  }
  // The Hub's RECORD_FILE (src/main/installed-plugins.ts).
  writeFileSync(
    join(dataDir, "installed-plugins.json"),
    JSON.stringify(installs.map(({ id, version }) => ({ id, version }))),
  );
}

/** A fixture installed as the version and id its Manifest says. */
export function fixtureInstall(fixture: string): FixtureInstall {
  return { fixture, id: fixture, version: "1.0.0" };
}

/** The Plugin names the Plugin Switcher lists, top to bottom. */
export function switcherNames(hubChrome: Page): Promise<string[]> {
  return hubChrome
    .getByRole("navigation")
    .getByRole("listitem")
    .allTextContents();
}

export type DisplayLanguage = "en-HK" | "zh-HK";

/**
 * The Display Language the Hub took from the OS, as the Hub Chrome's `<html lang>` says. The Hub
 * follows the OS, so tests of what it says pick their expected words with this.
 */
export async function displayLanguageOf(
  hubChrome: Page,
): Promise<DisplayLanguage> {
  const html = hubChrome.locator("html");
  await expect(html).toHaveAttribute("lang", /^(en|zh)-HK$/);
  return (await html.getAttribute("lang")) === "zh-HK" ? "zh-HK" : "en-HK";
}

/**
 * Crashes the Hub Chrome's renderer and waits in the main process for the Hub to reload it: a
 * crashed renderer never answers executeJavaScript. Says whether the first load was still running.
 * Playwright's page stays crashed even once the view has reloaded, so read the reloaded Hub Chrome
 * from the main process.
 */
export function crashHubChrome(hub: ElectronApplication): Promise<boolean[]> {
  return hub.evaluate(({ webContents }) =>
    Promise.all(
      webContents.getAllWebContents().map(async (contents) => {
        const wasLoading = contents.isLoading();
        // The did-finish-load after the crash: a first load can still finish while the crash is
        // on its way, and executeJavaScript on the dead renderer would then never answer.
        const reloaded = new Promise<void>((resolve) => {
          contents.once("render-process-gone", () => {
            contents.once("did-finish-load", () => {
              resolve();
            });
          });
        });
        contents.forcefullyCrashRenderer();
        await reloaded;
        return wasLoading;
      }),
    ),
  );
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
