import type { ElectronApplication } from "@playwright/test";
import { expect, hubLogLines, launchHub, lifecycleLine, test } from "./hub";

function exitCodeOf(hub: ElectronApplication): Promise<number | null> {
  return new Promise((resolve) => {
    hub.process().once("exit", resolve);
  });
}

function errorLine(message: RegExp): unknown {
  return {
    time: expect.any(String),
    source: "hub",
    level: "error",
    message: expect.stringMatching(message),
    pluginId: null,
    pluginVersion: null,
  };
}

async function crashHub(hub: ElectronApplication): Promise<number | null> {
  const exitCode = exitCodeOf(hub);
  // In a timer, so it escapes evaluate and reaches the process as uncaught.
  await hub.evaluate(() => {
    setTimeout(() => {
      throw new Error("boom");
    });
  });
  return exitCode;
}

test("an uncaught main-process exception is logged and the Hub quits", async ({
  hub,
  dataDir,
}) => {
  await hub.firstWindow();

  expect(await crashHub(hub)).toBe(1);
  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    errorLine(/^uncaughtException: Error\n\s+at /),
  ]);
});

test("an unhandled main-process rejection is logged and the Hub quits", async ({
  hub,
  dataDir,
}) => {
  await hub.firstWindow();
  const exitCode = exitCodeOf(hub);

  await hub.evaluate(() => {
    setTimeout(() => {
      void Promise.reject(new Error("boom"));
    });
  });

  expect(await exitCode).toBe(1);
  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    errorLine(/^unhandledRejection: Error\n\s+at /),
  ]);
});

/**
 * Crashes the Hub Chrome's renderer and waits in the main process for the Hub to reload it: a
 * crashed renderer never answers executeJavaScript. Says whether the first load was still running.
 */
function crashHubChrome(hub: ElectronApplication): Promise<boolean[]> {
  return hub.evaluate(({ webContents }) =>
    Promise.all(
      webContents.getAllWebContents().map(async (contents) => {
        const wasLoading = contents.isLoading();
        const reloaded = new Promise<void>((resolve) => {
          contents.once("did-finish-load", () => {
            resolve();
          });
        });
        contents.forcefullyCrashRenderer();
        await reloaded;
        return wasLoading;
      }),
    ),
  );
}

// Read from the main process: Playwright's page stays crashed even once the view has reloaded.
function hubChromeHeadings(hub: ElectronApplication): Promise<unknown[]> {
  return hub.evaluate(({ webContents }) =>
    Promise.all(
      webContents
        .getAllWebContents()
        .map((contents): Promise<unknown> =>
          contents.executeJavaScript(
            'document.querySelector("hub-chrome")?.shadowRoot?.querySelector("h1")?.textContent ?? null',
          ),
        ),
    ),
  );
}

const HUB_CHROME_GONE = /^Hub Chrome renderer gone: [a-z-]+, exit code -?\d+$/;

test("a crashed Hub Chrome renderer is logged and the Hub Chrome comes back", async ({
  hub,
  dataDir,
}) => {
  const hubChrome = await hub.firstWindow();
  await expect(hubChrome.getByText("Hawkeye Hub")).toBeVisible();

  await crashHubChrome(hub);

  await expect.poll(() => hubChromeHeadings(hub)).toEqual(["Hawkeye Hub"]);
  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    errorLine(HUB_CHROME_GONE),
  ]);
});

// A crash cuts the first load short, and the Hub must not take that for a failure of its own.
test("a Hub Chrome renderer that crashes while still loading comes back", async ({
  hub,
  dataDir,
}) => {
  await hub.firstWindow();

  const wasLoading = await crashHubChrome(hub);

  if (!wasLoading.every(Boolean)) {
    test.info().annotations.push({
      type: "skipped check",
      description: "the Hub Chrome had finished loading before it crashed",
    });
  }
  await expect.poll(() => hubChromeHeadings(hub)).toEqual(["Hawkeye Hub"]);
  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    errorLine(HUB_CHROME_GONE),
  ]);
});

test("the next start after a crash opens the Hub as usual, with no prompt", async ({
  hub,
  dataDir,
}) => {
  await hub.firstWindow();
  await crashHub(hub);

  const nextHub = await launchHub(dataDir);
  try {
    const hubChrome = await nextHub.firstWindow();
    await expect(hubChrome.getByText("Hawkeye Hub")).toBeVisible();
    // A prompt would be a second window or a native dialog, and a dialog would keep the Hub
    // Chrome from showing.
    const windowCount = await nextHub.evaluate(
      ({ BaseWindow }) => BaseWindow.getAllWindows().length,
    );
    expect(windowCount).toBe(1);
  } finally {
    await nextHub.close();
  }

  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    errorLine(/^uncaughtException: /),
    lifecycleLine("Hub opened"),
    lifecycleLine("Hub closing"),
  ]);
});
