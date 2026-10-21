import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";
import {
  bundleEntries,
  crashHubChrome,
  displayLanguageOf,
  exitCodeOf,
  expect,
  hubLogLines,
  launchHub,
  lifecycleLine,
  stubSaveDialog,
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

/** Presses the message box's button at index `response`. */
function answerMessageBox(
  hub: ElectronApplication,
  response: number,
): Promise<void> {
  return hub.evaluate((_electron, response) => {
    // In a timer, so evaluate returns before the answer can quit the Hub.
    setTimeout(() => {
      (
        globalThis as unknown as { messageBoxStub: MessageBoxStub }
      ).messageBoxStub.answer({ response, checkboxChecked: false });
    });
  }, response);
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

// The box in each Display Language; the Hub follows the OS's.
const STOPPED_UNEXPECTEDLY = {
  "en-HK": {
    message: "Hawkeye Hub stopped unexpectedly",
    detail: "Its window kept crashing.",
    buttons: ["Export diagnostics", "Quit"],
    cancelId: 1,
  },
  "zh-HK": {
    message: "Hawkeye Hub 意外停止運作",
    detail: "其視窗不斷當機。",
    buttons: ["匯出診斷資料", "結束"],
    cancelId: 1,
  },
};

const QUIT = 1;
const EXPORT_DIAGNOSTICS = 0;

/** Crashes the Hub Chrome 3 times, so the Hub gives up and shows its box. */
async function crashUntilGivenUp(hub: ElectronApplication): Promise<void> {
  const hubChrome = await hub.firstWindow();
  await expect(hubChrome.getByText("Hawkeye Hub")).toBeVisible();
  const language = await displayLanguageOf(hubChrome);
  await stubMessageBox(hub);
  await crashHubChrome(hub);
  await crashHubChrome(hub);

  await crashHubChromeForGood(hub);

  await expect
    .poll(() => messageBoxesShown(hub))
    .toEqual([{ type: "error", ...STOPPED_UNEXPECTEDLY[language] }]);
}

test("a Hub Chrome that crashes 3 times within 60 s is not reloaded, and the Hub quits", async ({
  hub,
  dataDir,
}) => {
  const exitCode = exitCodeOf(hub);
  await crashUntilGivenUp(hub);

  await answerMessageBox(hub, QUIT);
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

test("Export diagnostics in the kept-crashing box saves a bundle, then the Hub quits", async ({
  hub,
  dataDir,
}) => {
  const exitCode = exitCodeOf(hub);
  await crashUntilGivenUp(hub);
  const destination = join(
    mkdtempSync(join(tmpdir(), "hawkeye-hub-export-")),
    "bundle.zip",
  );
  // The Hub quits after, so what the save dialog was shown cannot be read back.
  await stubSaveDialog(hub, { canceled: false, filePath: destination });

  await answerMessageBox(hub, EXPORT_DIAGNOSTICS);

  expect(await exitCode).toBe(0);
  expect(existsSync(destination)).toBe(true);
  expect(Object.keys(bundleEntries(destination)).sort()).toEqual([
    "hub.log",
    "system.json",
  ]);
  expect(hubLogLines(dataDir).at(-1)).toEqual(lifecycleLine("Hub closing"));
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
