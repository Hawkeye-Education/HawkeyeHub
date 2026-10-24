// A Plugin that crashes, fails to start or breaks the protocol closes without asking and leaves a
// crash record (#53). #29 reuses these fixtures for the message staff see.

import type { ElectronApplication, Page } from "@playwright/test";
import {
  crashSummaries,
  displayLanguageOf,
  expect,
  fixtureInstall,
  hubLogLines,
  installFixturePlugins,
  launchHub,
  pluginLogMessages,
  pluginPage,
  test,
} from "./hub";

// The pages' globals, for code evaluated in them: a fixture Plugin UI's `hub`, the Hub Chrome's
// `hubChrome`.
declare const window: {
  hub: {
    backend: {
      request(method: string, params: unknown): Promise<unknown>;
      notify(method: unknown, params: unknown): Promise<void>;
    };
  };
  hubChrome: { open(id: string): void; close(id: string): void };
};

/** A Hub with `fixture` installed and opened from the Plugin Switcher by its plain English `name`. */
async function openFixture(
  dataDir: string,
  fixture: string,
  name: string,
): Promise<{ hub: ElectronApplication; hubChrome: Page }> {
  installFixturePlugins(dataDir, [fixtureInstall(fixture)]);
  const hub = await launchHub(dataDir);
  const hubChrome = await hub.firstWindow();
  await displayLanguageOf(hubChrome);
  await hubChrome.getByRole("button", { name, exact: true }).click();
  return { hub, hubChrome };
}

function closeButton(hubChrome: Page, name: string) {
  return hubChrome.getByRole("button", {
    name: new RegExp(`^(Close ${name}|關閉 ${name})$`),
  });
}

/** Asks the fixture's Backend `method` without waiting: the answer never comes. */
async function requestWithoutAnswer(page: Page, method: string): Promise<void> {
  await page.evaluate((method) => {
    void window.hub.backend.request(method, {});
  }, method);
}

test("a Backend that exits mid-request writes a crashed record and the Plugin closes", async ({
  dataDir,
}) => {
  const { hub, hubChrome } = await openFixture(
    dataDir,
    "crashing-backend",
    "Crashing",
  );
  try {
    const page = await pluginPage(() => hub.windows(), "crashing-backend");
    await expect(closeButton(hubChrome, "Crashing")).toBeVisible();

    await requestWithoutAnswer(page, "exit");

    const summary =
      "Plugin closed abnormally: crashed (Backend exited with code 3)";
    await expect(closeButton(hubChrome, "Crashing")).toHaveCount(0);
    await expect
      .poll(() => crashSummaries(dataDir, "crashing-backend"))
      .toEqual([summary]);
    expect(pluginLogMessages(dataDir, "crashing-backend")).toContain(summary);
  } finally {
    await hub.close();
  }
});

test("a Backend that writes a line that is not JSON-RPC writes a crashed record naming a protocol violation, and the Plugin closes", async ({
  dataDir,
}) => {
  const { hub, hubChrome } = await openFixture(
    dataDir,
    "crashing-backend",
    "Crashing",
  );
  try {
    const page = await pluginPage(() => hub.windows(), "crashing-backend");
    await expect(closeButton(hubChrome, "Crashing")).toBeVisible();

    await requestWithoutAnswer(page, "garbage");

    await expect(closeButton(hubChrome, "Crashing")).toHaveCount(0);
    await expect
      .poll(() => crashSummaries(dataDir, "crashing-backend"))
      .toEqual([
        "Plugin closed abnormally: crashed (protocol violation: a stdout line that is not JSON-RPC)",
      ]);
  } finally {
    await hub.close();
  }
});

test("a Plugin UI message that is not JSON-RPC writes a crashed record naming a protocol violation, and the Plugin closes while the Hub runs on", async ({
  dataDir,
}) => {
  const { hub, hubChrome } = await openFixture(
    dataDir,
    "crashing-backend",
    "Crashing",
  );
  try {
    const page = await pluginPage(() => hub.windows(), "crashing-backend");
    await expect(closeButton(hubChrome, "Crashing")).toBeVisible();

    // A method must be a string: the page's own mistake, which the preload passes on.
    await page.evaluate(() => {
      void window.hub.backend.notify(42, {});
    });

    await expect(closeButton(hubChrome, "Crashing")).toHaveCount(0);
    await expect
      .poll(() => crashSummaries(dataDir, "crashing-backend"))
      .toEqual([
        "Plugin closed abnormally: crashed (protocol violation: a Plugin UI message that is not JSON-RPC)",
      ]);
    // The Hub is still running: the Plugin reopens.
    await hubChrome
      .getByRole("button", { name: "Crashing", exact: true })
      .click();
    await expect(closeButton(hubChrome, "Crashing")).toBeVisible();
  } finally {
    await hub.close();
  }
});

test("a Backend whose initialize returns an error writes a failed to start record, and the Plugin closes", async ({
  dataDir,
}) => {
  const { hub, hubChrome } = await openFixture(
    dataDir,
    "rejecting-backend",
    "Rejecting",
  );
  try {
    await expect
      .poll(() => crashSummaries(dataDir, "rejecting-backend"))
      .toEqual([
        "initialize failed: rejected",
        "Plugin closed abnormally: failed to start",
      ]);
    await expect(closeButton(hubChrome, "Rejecting")).toHaveCount(0);
  } finally {
    await hub.close();
  }
});

test("a Plugin UI whose index.html is missing writes a failed to start record, and the Plugin closes", async ({
  dataDir,
}) => {
  const { hub, hubChrome } = await openFixture(
    dataDir,
    "missing-ui",
    "Missing UI",
  );
  try {
    await expect
      .poll(() => crashSummaries(dataDir, "missing-ui"))
      .toEqual([
        // The net error is Chromium's to choose: ERR_UNEXPECTED on Electron 44, where the
        // scheme handler's failed fetch of the missing file rejects.
        expect.stringMatching(
          /^Plugin closed abnormally: failed to start \(Plugin UI failed to load: ERR_[A-Z_]+\)$/,
        ),
      ]);
    await expect(closeButton(hubChrome, "Missing UI")).toHaveCount(0);
  } finally {
    await hub.close();
  }
});

/** How many Plugin UI pages the Hub still has, destroyed ones aside. */
function pluginUiCount(hub: ElectronApplication): Promise<number> {
  return hub.evaluate(
    ({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((contents) => contents.getURL().startsWith("hawkeye-plugin:"))
        .length,
  );
}

test("a Plugin UI whose renderer goes away writes a crashed record, and the Plugin closes", async ({
  dataDir,
}) => {
  const { hub, hubChrome } = await openFixture(
    dataDir,
    "crashing-backend",
    "Crashing",
  );
  try {
    await pluginPage(() => hub.windows(), "crashing-backend");
    await expect(closeButton(hubChrome, "Crashing")).toBeVisible();

    // Only the Plugin UI: the Hub Chrome is not a hawkeye-plugin:// page.
    await hub.evaluate(({ webContents }) => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.getURL().startsWith("hawkeye-plugin:")) {
          contents.forcefullyCrashRenderer();
        }
      }
    });

    await expect(closeButton(hubChrome, "Crashing")).toHaveCount(0);
    await expect
      .poll(() => crashSummaries(dataDir, "crashing-backend"))
      .toEqual([
        expect.stringMatching(
          /^Plugin closed abnormally: crashed \(Plugin UI gone: /,
        ),
      ]);
    // The crashed page is destroyed, as in a normal close.
    await expect.poll(() => pluginUiCount(hub)).toBe(0);
  } finally {
    await hub.close();
  }
});

test("a Plugin UI whose renderer goes away while it is still loading writes a crashed record, not a failed load", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("crashing-backend")]);
  const hub = await launchHub(dataDir);
  const hubChrome = await hub.firstWindow();
  await displayLanguageOf(hubChrome);
  // Crashes the Plugin UI as its page commits, before it has finished loading.
  await hub.evaluate(({ app }) => {
    app.on("web-contents-created", (_event, contents) => {
      contents.once("did-navigate", (_navigated, url) => {
        if (url.startsWith("hawkeye-plugin:"))
          contents.forcefullyCrashRenderer();
      });
    });
  });

  try {
    await hubChrome
      .getByRole("button", { name: "Crashing", exact: true })
      .click();

    await expect
      .poll(() => crashSummaries(dataDir, "crashing-backend"))
      .toEqual([
        expect.stringMatching(
          /^Plugin closed abnormally: crashed \(Plugin UI gone: /,
        ),
      ]);
    await expect(closeButton(hubChrome, "Crashing")).toHaveCount(0);
  } finally {
    await hub.close();
  }
  // The Hub itself never crashed: quitting waits for the Backend, so all of it is logged by now.
  expect(
    hubLogLines(dataDir).filter(
      (line) =>
        typeof line === "object" &&
        line !== null &&
        "pluginId" in line &&
        line.pluginId === null &&
        "level" in line &&
        line.level === "error",
    ),
  ).toEqual([]);
});

test("closing a Plugin while it is still loading records nothing", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("echo-backend")]);
  const hub = await launchHub(dataDir);
  const hubChrome = await hub.firstWindow();
  await displayLanguageOf(hubChrome);

  // Open and close at once, before the page has loaded or the Backend answered initialize.
  await hubChrome.evaluate(() => {
    window.hubChrome.open("echo-backend");
    window.hubChrome.close("echo-backend");
  });
  await expect.poll(() => pluginUiCount(hub)).toBe(0);
  // Quitting waits for the Backend to exit, so everything it would log is logged by then.
  await hub.close();

  expect(crashSummaries(dataDir, "echo-backend")).toEqual([]);
});
