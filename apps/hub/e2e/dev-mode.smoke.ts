// Dev mode (#83, PLUGIN_STANDARD §9.4): `--plugin <id>` runs `<--plugins-dir>/<id>` as the Hub's
// only Plugin, without the record of installed Plugins. Its Plugin UIs get DevTools, and each
// Backend's stderr is copied to the terminal (#31).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  displayLanguageOf,
  electronBinary,
  expect,
  fixtureInstall,
  FIXTURE_PLUGINS,
  HUB_DIR,
  hubEnv,
  hubLogLines,
  installFixturePlugins,
  launchHub,
  pluginLogMessages,
  pluginPage,
  switcherNames,
  test,
} from "./hub";

// The fixture Plugin UI's page globals, for code evaluated in its page.
declare const window: {
  hub: {
    backend: { request(method: string, params: unknown): Promise<unknown> };
  };
};

function launchDevHub(dataDir: string): Promise<ElectronApplication> {
  return _electron.launch({
    args: [
      HUB_DIR,
      "--plugins-dir",
      FIXTURE_PLUGINS,
      "--plugin",
      "echo-backend",
    ],
    env: hubEnv(dataDir),
  });
}

/** Opens the echo-backend fixture: its name is plain English, the same in every Display Language. */
async function openEcho(hub: ElectronApplication): Promise<Page> {
  const hubChrome = await hub.firstWindow();
  await displayLanguageOf(hubChrome);
  await hubChrome.getByRole("button", { name: "Echo", exact: true }).click();
  return pluginPage(() => hub.windows(), "echo-backend");
}

async function closeEcho(hub: ElectronApplication): Promise<void> {
  const hubChrome = await hub.firstWindow();
  await hubChrome
    .getByRole("button", { name: /^(Close Echo|關閉 Echo)$/ })
    .click();
}

/** Everything the Hub writes to its stderr, the terminal, from now on. */
function captureStderr(hub: ElectronApplication): { text: string } {
  const captured = { text: "" };
  const { stderr } = hub.process();
  if (stderr === null) throw new Error("Playwright pipes the Hub's stderr");
  stderr.setEncoding("utf8");
  stderr.on("data", (chunk: string) => {
    captured.text += chunk;
  });
  return captured;
}

/**
 * Presses the DevTools shortcut in `page` from the main process: Playwright's own key presses go
 * straight to the renderer and never reach `before-input-event` (probed on Electron 44).
 */
async function pressDevToolsShortcut(
  hub: ElectronApplication,
  page: Page,
): Promise<void> {
  await hub.evaluate(
    ({ webContents }, { url, darwin }) => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.getURL() !== url) continue;
        contents.sendInputEvent({
          type: "keyDown",
          keyCode: "I",
          modifiers: darwin ? ["meta", "alt"] : ["control", "shift"],
        });
      }
    },
    { url: page.url(), darwin: process.platform === "darwin" },
  );
}

function devToolsOpened(
  hub: ElectronApplication,
  page: Page,
): Promise<boolean> {
  return hub.evaluate(
    ({ webContents }, url) =>
      webContents
        .getAllWebContents()
        .some(
          (contents) =>
            contents.getURL() === url && contents.isDevToolsOpened(),
        ),
    page.url(),
  );
}

/**
 * How long a shortcut that did nothing is given to have opened DevTools after all: they open
 * asynchronously, after the call (probed: well within this on Electron 44).
 */
const DEVTOOLS_SETTLE_MS = 2_000;

test("dev mode opens the named Plugin from its folder and never touches the record", async ({
  dataDir,
}) => {
  const hub = await launchDevHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    await displayLanguageOf(hubChrome);
    expect(await switcherNames(hubChrome)).toEqual(["Echo"]);
    const echo = await openEcho(hub);
    // The Backend runs from the fixture's own backend folder.
    const { cwd } = (await echo.evaluate(() =>
      window.hub.backend.request("report", {}),
    )) as { cwd: string };
    expect(cwd).toBe(join(FIXTURE_PLUGINS, "echo-backend", "backend"));
    expect(existsSync(join(dataDir, "installed-plugins.json"))).toBe(false);
  } finally {
    await hub.close();
  }
});

// The Hub Chrome's element, whose snapshot is null until the preload delivers the first.
declare const document: {
  querySelector(
    selector: string,
  ): { snapshot: { theme: string } | null } | null;
};

// The fixture's Theme, harbour, is one this Hub lacks: the snapshot draws Hawkeye and hub.log says
// why, which only the file's Theme reaching the lifecycle can cause.
test("dev mode's --company-config file is the Company Configuration, fetched and cached never", async ({
  dataDir,
}) => {
  const hub = await _electron.launch({
    args: [
      HUB_DIR,
      "--plugins-dir",
      FIXTURE_PLUGINS,
      "--plugin",
      "class-timer",
      "--company-config",
      join(import.meta.dirname, "fixtures", "company-config.json"),
    ],
    env: hubEnv(dataDir),
  });
  try {
    const hubChrome = await hub.firstWindow();
    await expect
      .poll(() =>
        hubChrome.evaluate(
          () => document.querySelector("hub-chrome")?.snapshot?.theme,
        ),
      )
      .toBe("hawkeye");
    expect(hubLogLines(dataDir)).toContainEqual(
      expect.objectContaining({
        message: "Theme harbour unknown to this Hub, using hawkeye",
      }),
    );
    expect(existsSync(join(dataDir, "company-config.json"))).toBe(false);
  } finally {
    await hub.close();
  }
});

test("dev mode with a Plugin that cannot be loaded exits non-zero with why", async ({
  dataDir,
}) => {
  const child = spawn(
    electronBinary,
    [HUB_DIR, "--plugins-dir", FIXTURE_PLUGINS, "--plugin", "invalid-manifest"],
    { env: hubEnv(dataDir), stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve) => {
    child.once("exit", resolve);
  });
  expect(code).toBe(1);
  expect(stderr).toContain('Plugin "invalid-manifest"');
  expect(stderr).toContain("manifest-invalid");
});

test("in dev mode the shortcut opens a Plugin UI's DevTools, and its Backend's stderr is in the terminal and the log", async ({
  dataDir,
}) => {
  const hub = await launchDevHub(dataDir);
  const stderr = captureStderr(hub);
  try {
    const echo = await openEcho(hub);
    await pressDevToolsShortcut(hub, echo);
    await expect.poll(() => devToolsOpened(hub, echo)).toBe(true);

    await closeEcho(hub);

    // The fixture Backend writes "got shutdown" to stderr as it exits.
    await expect
      .poll(() => stderr.text)
      .toContain("[echo-backend] got shutdown\n");
    await expect
      .poll(() => pluginLogMessages(dataDir, "echo-backend"))
      .toContain("got shutdown");
  } finally {
    await hub.close();
  }
});

test("an installed Hub's Plugin UI cannot open DevTools, and its Backend's stderr is not in the terminal", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("echo-backend")]);
  const hub = await launchHub(dataDir);
  const stderr = captureStderr(hub);
  try {
    const echo = await openEcho(hub);
    await pressDevToolsShortcut(hub, echo);
    await new Promise((resolve) => setTimeout(resolve, DEVTOOLS_SETTLE_MS));
    expect(await devToolsOpened(hub, echo)).toBe(false);

    await closeEcho(hub);

    await expect
      .poll(() => pluginLogMessages(dataDir, "echo-backend"))
      .toContain("got shutdown");
    expect(stderr.text).not.toContain("got shutdown");
  } finally {
    await hub.close();
  }
});
