// A Busy Plugin asks before it closes and before the Hub quits, on the dialog overlay (#54).

import type { ElectronApplication, Page } from "@playwright/test";
import {
  displayLanguageOf,
  exitCodeOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  overlay,
  overlayShowing,
  pluginPage,
  press,
  test,
  type DisplayLanguage,
} from "./hub";

// What the Hub Chrome says, in each Display Language; the Hub follows the OS's.
const WORDS = {
  "en-HK": {
    timer: "Timer",
    attendance: "Attendance",
    closeTimer: "Close Timer",
    closeTimerQuestion: "Close Timer?",
    quitQuestion: "Quit Hawkeye Hub?",
    keepOpen: "Keep open",
    closeAnyway: "Close anyway",
    quitAnyway: "Quit anyway",
  },
  "zh-HK": {
    timer: "計時器",
    attendance: "點名",
    closeTimer: "關閉 計時器",
    closeTimerQuestion: "關閉 計時器？",
    quitQuestion: "結束 Hawkeye Hub？",
    keepOpen: "保持開啟",
    closeAnyway: "仍然關閉",
    quitAnyway: "仍然結束",
  },
} satisfies Record<DisplayLanguage, unknown>;
type Words = (typeof WORDS)[DisplayLanguage];

// A fixture Plugin UI's `window.hub`, for code evaluated in its page.
declare const window: {
  hub: {
    busy: { set(reason: string): Promise<void>; clear(): Promise<void> };
    backend: { request(method: string, params: unknown): Promise<unknown> };
  };
};

async function hubWith(
  dataDir: string,
  fixtures: string[],
): Promise<{ hub: ElectronApplication; hubChrome: Page; words: Words }> {
  installFixturePlugins(dataDir, fixtures.map(fixtureInstall));
  const hub = await launchHub(dataDir);
  const hubChrome = await hub.firstWindow();
  return { hub, hubChrome, words: WORDS[await displayLanguageOf(hubChrome)] };
}

/** Opens Plugin `id` from the Switcher by `name` and marks it Busy with `reason`. */
async function openBusy(
  hub: ElectronApplication,
  hubChrome: Page,
  name: string,
  id: string,
  reason: string,
): Promise<Page> {
  await hubChrome.getByRole("button", { name, exact: true }).click();
  const page = await pluginPage(() => hub.windows(), id);
  await page.evaluate((reason) => window.hub.busy.set(reason), reason);
  return page;
}

test("closing a Busy Plugin asks with its reason; Keep open leaves it open and Close anyway closes it", async ({
  dataDir,
}) => {
  const { hub, hubChrome, words } = await hubWith(dataDir, ["class-timer"]);
  try {
    await openBusy(
      hub,
      hubChrome,
      words.timer,
      "class-timer",
      "Timing an exam",
    );
    const closeTimer = hubChrome.getByRole("button", {
      name: words.closeTimer,
    });

    await closeTimer.click();
    let dialog = (await overlay(hub)).getByRole("dialog");
    await expect(dialog).toContainText(words.closeTimerQuestion);
    await expect(dialog).toContainText("Timing an exam");
    await press(dialog.getByRole("button", { name: words.keepOpen }));
    await expect.poll(() => overlayShowing(hub)).toBe(false);
    await expect(closeTimer).toBeVisible();

    await closeTimer.click();
    dialog = (await overlay(hub)).getByRole("dialog");
    await press(dialog.getByRole("button", { name: words.closeAnyway }));
    await expect(closeTimer).toHaveCount(0);
    await expect.poll(() => overlayShowing(hub)).toBe(false);
  } finally {
    await hub.close();
  }
});

test("Enter and Esc both pick Keep open", async ({ dataDir }) => {
  const { hub, hubChrome, words } = await hubWith(dataDir, ["class-timer"]);
  try {
    const timer = await openBusy(
      hub,
      hubChrome,
      words.timer,
      "class-timer",
      "Timing an exam",
    );
    const closeTimer = hubChrome.getByRole("button", {
      name: words.closeTimer,
    });

    for (const key of ["Enter", "Escape"]) {
      await closeTimer.click();
      const page = await overlay(hub);
      await expect(page.getByRole("dialog")).toBeVisible();
      // Down only: the key answers as it goes down, and the overlay is gone before it comes up.
      await page.keyboard.down(key);
      await expect.poll(() => overlayShowing(hub)).toBe(false);
      await expect(closeTimer).toBeVisible();
    }
    // Not Busy, so the Hub quits at teardown without asking.
    await timer.evaluate(() => window.hub.busy.clear());
  } finally {
    await hub.close();
  }
});

test("closing a Plugin that is not Busy asks nothing", async ({ dataDir }) => {
  const { hub, hubChrome, words } = await hubWith(dataDir, ["class-timer"]);
  try {
    await hubChrome
      .getByRole("button", { name: words.timer, exact: true })
      .click();
    await pluginPage(() => hub.windows(), "class-timer");
    const closeTimer = hubChrome.getByRole("button", {
      name: words.closeTimer,
    });

    await closeTimer.click();
    await expect(closeTimer).toHaveCount(0);
    expect(overlayShowing(hub)).toBe(false);
  } finally {
    await hub.close();
  }
});

test("an empty Busy reason is refused: the call rejects, and closing asks nothing", async ({
  dataDir,
}) => {
  const { hub, hubChrome, words } = await hubWith(dataDir, ["class-timer"]);
  try {
    await hubChrome
      .getByRole("button", { name: words.timer, exact: true })
      .click();
    const timer = await pluginPage(() => hub.windows(), "class-timer");

    await expect(
      timer.evaluate(() => window.hub.busy.set("")),
    ).rejects.toThrow();

    const closeTimer = hubChrome.getByRole("button", {
      name: words.closeTimer,
    });
    await closeTimer.click();
    await expect(closeTimer).toHaveCount(0);
    expect(overlayShowing(hub)).toBe(false);
  } finally {
    await hub.close();
  }
});

test("quitting with two Busy Plugins asks once, listing both; Keep open keeps the Hub running and Quit anyway quits", async ({
  dataDir,
}) => {
  const { hub, hubChrome, words } = await hubWith(dataDir, [
    "class-timer",
    "attendance",
  ]);
  const exitCode = exitCodeOf(hub);
  await openBusy(hub, hubChrome, words.timer, "class-timer", "Timing an exam");
  await openBusy(
    hub,
    hubChrome,
    words.attendance,
    "attendance",
    "Taking the register",
  );

  await hub.evaluate(({ app }) => {
    app.quit();
  });
  let page = await overlay(hub);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(words.quitQuestion);
  for (const text of [
    words.timer,
    "Timing an exam",
    words.attendance,
    "Taking the register",
  ]) {
    await expect(dialog).toContainText(text);
  }
  expect(
    hub.windows().filter((each) => each.url().endsWith("#dialog")),
  ).toHaveLength(1);
  await press(dialog.getByRole("button", { name: words.keepOpen }));
  await expect.poll(() => overlayShowing(hub)).toBe(false);
  await expect(
    hubChrome.getByRole("button", { name: words.closeTimer }),
  ).toBeVisible();

  await hub.evaluate(({ app }) => {
    app.quit();
  });
  page = await overlay(hub);
  await press(page.getByRole("button", { name: words.quitAnyway }));
  expect(await exitCode).toBe(0);
});

test("a Busy Plugin whose Backend crashes while its dialog is up closes, and its crash message takes the dialog's place", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("crashing-backend")]);
  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    await displayLanguageOf(hubChrome);
    const page = await openBusy(
      hub,
      hubChrome,
      "Crashing",
      "crashing-backend",
      "Saving",
    );
    const closeButton = hubChrome.getByRole("button", {
      name: /^(Close Crashing|關閉 Crashing)$/,
    });
    await closeButton.click();
    await overlay(hub);

    await page.evaluate(() => {
      void window.hub.backend.request("exit", {});
    });

    await expect(closeButton).toHaveCount(0);
    const dialog = (await overlay(hub)).getByRole("dialog");
    await expect(dialog).toContainText(
      /Crashing (stopped unexpectedly|意外停止運作)/,
    );
    await expect(dialog).not.toContainText("Saving");
  } finally {
    await hub.close();
  }
});
