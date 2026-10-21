// Leaving Hub Settings with unsaved edits asks "Discard unsaved changes?" first, on the dialog
// overlay, before picking a Plugin and before quitting (#74). Answered from the keyboard.

import type { ElectronApplication, Page } from "@playwright/test";
import {
  answerWithKey,
  displayLanguageOf,
  exitCodeOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  pluginPage,
  test,
  type DisplayLanguage,
} from "./hub";

const WORDS = {
  "en-HK": {
    timer: "Timer",
    settings: "Settings",
    dark: "Dark",
    discardQuestion: "Discard unsaved changes?",
    keepEditing: "Keep editing",
    discard: "Discard",
    quitQuestion: "Quit Hawkeye Hub?",
    quitAnyway: "Quit anyway",
  },
  "zh-HK": {
    timer: "計時器",
    settings: "設定",
    dark: "深色",
    discardQuestion: "捨棄未儲存的變更？",
    keepEditing: "繼續編輯",
    discard: "捨棄",
    quitQuestion: "結束 Hawkeye Hub？",
    quitAnyway: "仍然結束",
  },
} satisfies Record<DisplayLanguage, unknown>;

// A fixture Plugin UI's `window.hub`, for code evaluated in its page.
declare const window: {
  hub: { busy: { set(reason: string): Promise<void> } };
};

/** The dialog overlay's page, once it is showing: a new one, if the one `after` is given. */
async function overlay(
  hub: ElectronApplication,
  after: Page | null = null,
): Promise<Page> {
  let page: Page | undefined;
  await expect
    .poll(() => {
      page = hub
        .windows()
        .find((each) => each !== after && each.url().endsWith("#dialog"));
      return page !== undefined;
    })
    .toBe(true);
  if (page === undefined) throw new Error("unreachable: polled for above");
  return page;
}

function overlayShowing(hub: ElectronApplication): boolean {
  return hub.windows().some((page) => page.url().endsWith("#dialog"));
}

/**
 * Presses the dialog button named `name` with Enter going down only: its answer takes the overlay
 * away, which can lose a mouse click's page before its mouseup (plugin-busy.smoke.ts).
 */
async function press(page: Page, name: string): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name }).focus();
  await answerWithKey(page, "Enter");
}

test("picking a Plugin with unsaved edits asks first: Keep editing stays, Discard opens it", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    const words = WORDS[await displayLanguageOf(hubChrome)];
    const timer = hubChrome.getByRole("button", {
      name: words.timer,
      exact: true,
    });
    const dark = hubChrome.getByRole("radio", { name: words.dark });

    // No edits: nothing is asked.
    await hubChrome.getByRole("button", { name: words.settings }).click();
    await timer.click();
    await pluginPage(() => hub.windows(), "class-timer");
    await expect(dark).toHaveCount(0);
    expect(overlayShowing(hub)).toBe(false);

    await hubChrome.getByRole("button", { name: words.settings }).click();
    await dark.check();
    await timer.click();
    let page = await overlay(hub);
    await expect(page.getByRole("dialog")).toContainText(words.discardQuestion);
    await press(page, words.keepEditing);
    await expect.poll(() => overlayShowing(hub)).toBe(false);
    await expect(dark).toBeChecked();

    await timer.click();
    page = await overlay(hub);
    await press(page, words.discard);
    await expect.poll(() => overlayShowing(hub)).toBe(false);
    await expect(dark).toHaveCount(0);

    await hubChrome.getByRole("button", { name: words.settings }).click();
    await expect(dark).not.toBeChecked();
  } finally {
    await hub.close();
  }
});

test("quitting with unsaved edits asks first: Esc keeps editing, Discard goes on to the Busy dialog", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const hub = await launchHub(dataDir);
  const exitCode = exitCodeOf(hub);
  const hubChrome = await hub.firstWindow();
  const words = WORDS[await displayLanguageOf(hubChrome)];
  await hubChrome
    .getByRole("button", { name: words.timer, exact: true })
    .click();
  const timer = await pluginPage(() => hub.windows(), "class-timer");
  await timer.evaluate(() => window.hub.busy.set("Timing an exam"));
  await hubChrome.getByRole("button", { name: words.settings }).click();
  const dark = hubChrome.getByRole("radio", { name: words.dark });
  await dark.check();

  await hub.evaluate(({ app }) => {
    app.quit();
  });
  let page = await overlay(hub);
  await expect(page.getByRole("dialog")).toContainText(words.discardQuestion);
  await answerWithKey(page, "Escape");
  await expect.poll(() => overlayShowing(hub)).toBe(false);
  await expect(dark).toBeChecked();

  await hub.evaluate(({ app }) => {
    app.quit();
  });
  page = await overlay(hub);
  await press(page, words.discard);
  // Discard takes its overlay away, and the Busy quit dialog comes up on a new one.
  page = await overlay(hub, page);
  await expect(page.getByRole("dialog")).toContainText(words.quitQuestion);
  await press(page, words.quitAnyway);
  expect(await exitCode).toBe(0);
});
