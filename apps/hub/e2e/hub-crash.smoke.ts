import type { ElectronApplication } from "@playwright/test";
import {
  exitCodeOf,
  expect,
  hubLogLines,
  launchHub,
  lifecycleLine,
  test,
} from "./hub";

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

// The main process's dialog stub: the options of each message box shown, and how to answer the
// one on screen. A global, because each evaluate is serialized and shares no closure.
interface MessageBoxStub {
  shown: unknown[];
  answer: (result: { response: number; checkboxChecked: boolean }) => void;
}

/** Replaces dialog.showMessageBox in the main process with a stub that waits to be answered. */
function stubMessageBox(hub: ElectronApplication): Promise<void> {
  return hub.evaluate(({ dialog }) => {
    const stub: MessageBoxStub = { shown: [], answer: () => undefined };
    (
      globalThis as unknown as { messageBoxStub: MessageBoxStub }
    ).messageBoxStub = stub;
    dialog.showMessageBox = (...args: unknown[]) => {
      // Called as (options) or (window, options).
      stub.shown.push(args.at(-1));
      return new Promise((resolve) => {
        stub.answer = resolve;
      });
    };
  });
}

function messageBoxesShown(hub: ElectronApplication): Promise<unknown[]> {
  return hub.evaluate(
    () =>
      (globalThis as unknown as { messageBoxStub: MessageBoxStub })
        .messageBoxStub.shown,
  );
}

/** Presses the message box's first button. */
function answerMessageBox(hub: ElectronApplication): Promise<void> {
  return hub.evaluate(() => {
    // In a timer, so evaluate returns before the answer can quit the Hub.
    setTimeout(() => {
      (
        globalThis as unknown as { messageBoxStub: MessageBoxStub }
      ).messageBoxStub.answer({ response: 0, checkboxChecked: false });
    });
  });
}

/** Crashes the Hub Chrome's renderer without waiting for a reload. */
function crashHubChromeForGood(hub: ElectronApplication): Promise<void> {
  return hub.evaluate(({ webContents }) => {
    for (const contents of webContents.getAllWebContents()) {
      contents.forcefullyCrashRenderer();
    }
  });
}

test("a crashed Hub Chrome renderer is logged and the Hub Chrome comes back", async ({
  hub,
  dataDir,
}) => {
  const hubChrome = await hub.firstWindow();
  await expect(hubChrome.getByText("Hawkeye Hub")).toBeVisible();
  await stubMessageBox(hub);

  await crashHubChrome(hub);

  await expect.poll(() => hubChromeHeadings(hub)).toEqual(["Hawkeye Hub"]);
  expect(await messageBoxesShown(hub)).toEqual([]);
  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    errorLine(HUB_CHROME_GONE),
  ]);
});

test("a Hub Chrome that crashes 3 times within 60 s is not reloaded, and the Hub quits", async ({
  hub,
  dataDir,
}) => {
  const hubChrome = await hub.firstWindow();
  await expect(hubChrome.getByText("Hawkeye Hub")).toBeVisible();
  await stubMessageBox(hub);
  await crashHubChrome(hub);
  await crashHubChrome(hub);
  const exitCode = exitCodeOf(hub);

  await crashHubChromeForGood(hub);

  await expect
    .poll(() => messageBoxesShown(hub))
    .toEqual([
      {
        type: "error",
        message: "Hawkeye Hub stopped unexpectedly",
        detail: "Its window kept crashing.",
        buttons: ["Quit"],
      },
    ]);
  await answerMessageBox(hub);
  expect(await exitCode).toBe(0);
  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    errorLine(HUB_CHROME_GONE),
    errorLine(HUB_CHROME_GONE),
    errorLine(HUB_CHROME_GONE),
    errorLine(/^Hub Chrome kept crashing: 3 times in 60 s, giving up$/),
    lifecycleLine("Hub closing"),
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
