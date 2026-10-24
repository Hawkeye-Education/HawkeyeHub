// The smoke harness: every test gets a fresh HAWKEYE_HUB_DATA_DIR and the built Hub running in it.

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  _electron,
  chromium,
  test as base,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { unzipSync } from "fflate";
import { errorCode } from "../src/main/error-code";

// The package directory, so Electron reads package.json's `main` and `productName`.
export const HUB_DIR = join(import.meta.dirname, "..");

/**
 * A Registry offering no Plugins, which every Hub checks unless a test names another: a smoke test
 * never reaches the real Registry, and its check logs nothing. Its sibling `company-config.json`
 * is the Company Configuration every Hub fetches, so that fetch logs nothing either.
 */
export const EMPTY_REGISTRY = pathToFileURL(
  join(import.meta.dirname, "fixtures", "registry", "empty.json"),
).href;

/** The environment a Hub runs in: this one plus its data folder and the empty Registry. */
// Inferred: _electron.launch's env type is narrower than NodeJS.ProcessEnv but accepts the spread.
export function hubEnv(dataDir: string) {
  return {
    ...process.env,
    HAWKEYE_HUB_DATA_DIR: dataDir,
    HAWKEYE_HUB_REGISTRY_URL: EMPTY_REGISTRY,
  };
}

export function launchHub(dataDir: string): Promise<ElectronApplication> {
  // `env` replaces the environment rather than adding to it.
  return _electron.launch({ args: [HUB_DIR], env: hubEnv(dataDir) });
}

// The electron package's runtime export is the binary's path, but its types describe the
// Electron API, so it is read as unknown and narrowed.
const electronExport: unknown = createRequire(import.meta.url)("electron");
if (typeof electronExport !== "string") {
  throw new Error("electron did not resolve to its binary path");
}
export const electronBinary: string = electronExport;

/** A Hub driven over CDP: its pages only, with no main-process access. */
export interface CdpHub {
  hubChrome: Page;
  /** Every open page: the Hub Chrome and each Plugin UI. */
  pages: () => Page[];
  /** Kills the Hub: no "Hub closing", so tests of the log use `launchHub`. */
  close(): Promise<void>;
}

/**
 * Launches the Hub and connects over CDP without Playwright's default overrides. `launchHub`'s
 * focus emulation keeps every page's `document.visibilityState` "visible" whatever the Hub does
 * (probed: hiding, removing or minimising changed nothing until it was gone), so tests of
 * visibility use this.
 */
export async function launchHubOverCdp(dataDir: string): Promise<CdpHub> {
  // Without focus emulation the OS's view of the window counts: an occluded window, behind another
  // or with the display asleep, hides every page and stalls Playwright's clicks. Playwright's own
  // Chromium launches pass these same switches.
  const args = [
    HUB_DIR,
    "--remote-debugging-port=0",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion",
  ];
  const child = spawn(electronBinary, args, {
    env: hubEnv(dataDir),
    stdio: ["ignore", "ignore", "pipe"],
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
      if (match?.[1] !== undefined) resolve(match[1]);
    });
    void exited.then(() => {
      reject(new Error(`The Hub exited before it was ready:\n${stderr}`));
    });
  });
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  const [context] = browser.contexts();
  if (context === undefined) throw new Error("The Hub has no browser context");
  const pages = (): Page[] => context.pages();
  let hubChrome: Page | undefined;
  await expect
    .poll(() => {
      hubChrome = pages().find((page) => page.url().startsWith("file:"));
      return hubChrome !== undefined;
    })
    .toBe(true);
  if (hubChrome === undefined) throw new Error("unreachable: polled for above");
  return {
    hubChrome,
    pages,
    close: async () => {
      await browser.close();
      child.kill();
      await exited;
    },
  };
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

/** The crash summaries hub.log holds for Plugin `id`. */
export function crashSummaries(dataDir: string, id: string): string[] {
  return hubLogLines(dataDir).flatMap((line) =>
    typeof line === "object" &&
    line !== null &&
    "pluginId" in line &&
    line.pluginId === id &&
    "level" in line &&
    line.level === "error" &&
    "message" in line &&
    typeof line.message === "string"
      ? [line.message]
      : [],
  );
}

export const FIXTURE_PLUGINS = join(import.meta.dirname, "fixtures", "plugins");

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

/** The Plugin names the Plugin Switcher lists, top to bottom, while no Plugin is open. */
export async function switcherNames(hubChrome: Page): Promise<string[]> {
  return (
    await hubChrome
      .getByRole("navigation")
      .getByRole("listitem")
      .allTextContents()
  ).map((text) => text.trim());
}

export type DisplayLanguage = "en-HK" | "zh-HK";

/** The Hub's "Export diagnostics" button and box button, in each Display Language. */
export const EXPORT_DIAGNOSTICS_WORDS = {
  "en-HK": "Export diagnostics",
  "zh-HK": "匯出診斷資料",
} satisfies Record<DisplayLanguage, string>;

/**
 * The globals of a fixture Plugin UI with a Backend, for code evaluated in its page. Each file
 * declares `window` with it: an imported binding would be renamed inside the serialized callback.
 */
export interface BackendFixtureWindow {
  hub: {
    backend: { request(method: string, params: unknown): Promise<unknown> };
  };
}

/** A log's lines in a Diagnostics Bundle, parsed. Throws if the bundle has no such log. */
export function linesOf(log: string | undefined): unknown[] {
  if (log === undefined) throw new Error("The bundle has no such log");
  return log
    .trimEnd()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
}

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
      webContents
        .getAllWebContents()
        // Only the Hub Chrome: Plugin UIs are hawkeye-plugin:// pages.
        .filter((contents) => !contents.getURL().startsWith("hawkeye-plugin:"))
        .map(async (contents) => {
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

/** The open Plugin UI of Plugin `id` among `pages`, once there is one and its scripts have run. */
export async function pluginPage(
  pages: () => Page[],
  id: string,
): Promise<Page> {
  let page: Page | undefined;
  await expect
    .poll(() => {
      page = pluginPages(pages(), id)[0];
      return page !== undefined;
    })
    .toBe(true);
  if (page === undefined) throw new Error("unreachable: polled for above");
  // The page is listed as soon as its URL commits, before its classic scripts have run.
  await page.waitForLoadState("domcontentloaded");
  return page;
}

/** Every open Plugin UI of Plugin `id` among `pages`: never more than one. */
export function pluginPages(pages: Page[], id: string): Page[] {
  return pages.filter((page) =>
    page.url().startsWith(`hawkeye-plugin://${id}/`),
  );
}

/** The dialog overlay's page, once it is showing. */
export async function overlay(hub: ElectronApplication): Promise<Page> {
  let page: Page | undefined;
  await expect
    .poll(() => {
      page = hub.windows().find((each) => each.url().endsWith("#dialog"));
      return page !== undefined;
    })
    .toBe(true);
  if (page === undefined) throw new Error("unreachable: polled for above");
  return page;
}

/** Whether the dialog overlay is showing. */
export function overlayShowing(hub: ElectronApplication): boolean {
  return hub.windows().some((page) => page.url().endsWith("#dialog"));
}

/**
 * Answers the dialog on the overlay `page` with `key` going down only: the key answers as it goes
 * down. The answer can take the overlay away before even the keydown is acknowledged (seen on
 * macOS CI), so a closed page is not an error here; callers check what the answer did.
 */
export async function answerWithKey(page: Page, key: string): Promise<void> {
  try {
    await page.keyboard.down(key);
  } catch (error) {
    if (!page.isClosed()) throw error;
  }
}

/**
 * Presses a dialog button with Enter going down only. An answer can take the overlay away, so a
 * mouse click can lose its page before the mouseup that fired it is acknowledged (seen on macOS
 * CI).
 */
export async function press(button: Locator): Promise<void> {
  await button.focus();
  await answerWithKey(button.page(), "Enter");
}

/** The messages in a Plugin's log, oldest first, or none if it has no log yet. */
export function pluginLogMessages(dataDir: string, id: string): string[] {
  const log = join(dataDir, "logs", "plugins", `${id}.log`);
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => (JSON.parse(line) as { message: string }).message);
}

/**
 * Replaces dialog.showSaveDialog in the main process with a stub that answers at once: with
 * `destination`, or cancelled. Returns the default path of each save dialog shown, read with the
 * function it resolves to. A global, because each evaluate is serialized and shares no closure.
 */
export async function stubSaveDialog(
  hub: ElectronApplication,
  answer: { canceled: boolean; filePath: string },
): Promise<() => Promise<string[]>> {
  await hub.evaluate(({ dialog }, answer) => {
    const shown: string[] = [];
    (globalThis as unknown as { saveDialogsShown: string[] }).saveDialogsShown =
      shown;
    dialog.showSaveDialog = (...args: unknown[]) => {
      // Called as (options) or (window, options).
      const options = args.at(-1) as { defaultPath: string };
      shown.push(options.defaultPath);
      return Promise.resolve(answer);
    };
  }, answer);
  return () =>
    hub.evaluate(
      () =>
        (globalThis as unknown as { saveDialogsShown: string[] })
          .saveDialogsShown,
    );
}

/** A Diagnostics Bundle's entries: each path inside the zip and its text. */
export function bundleEntries(bundle: string): Record<string, string> {
  const decoder = new TextDecoder();
  return Object.fromEntries(
    Object.entries(unzipSync(readFileSync(bundle))).map(([path, bytes]) => [
      path,
      decoder.decode(bytes),
    ]),
  );
}

export const BUNDLE_FILE_NAME = /hawkeye-hub-diagnostics-\d{8}-\d{6}\.zip$/;

export function isRunning(pid: number): boolean {
  try {
    // Signal 0 only checks that the process exists.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) !== "ESRCH") throw error;
    return false;
  }
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
