// Opening, switching between and closing UI-only Plugins (#48). Tests of visibility drive the Hub
// over CDP (`launchHubOverCdp`): under `launchHub` every page always reports "visible".

import type { ElectronApplication, Page } from "@playwright/test";
import {
  crashHubChrome,
  displayLanguageOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  launchHubOverCdp,
  pluginLogMessages,
  pluginPage,
  pluginPages,
  test,
  type DisplayLanguage,
} from "./hub";

// What the Hub Chrome says, in each Display Language; the Hub follows the OS's.
const WORDS = {
  "en-HK": {
    timer: "Timer",
    attendance: "Attendance",
    closeTimer: "Close Timer",
    closeAttendance: "Close Attendance",
    noPluginOpen: "No Plugin is open",
  },
  "zh-HK": {
    timer: "計時器",
    attendance: "點名",
    closeTimer: "關閉 計時器",
    closeAttendance: "關閉 點名",
    noPluginOpen: "未有開啟任何外掛程式",
  },
} satisfies Record<DisplayLanguage, unknown>;
type Words = (typeof WORDS)[DisplayLanguage];

// The fixture Plugin UI's own globals, for code evaluated in its page; the smoke suite has no DOM types.
declare const window: {
  observed: {
    displayLanguage: string;
    lang: string;
    hubKeys: string[];
    hubFrozen: boolean;
    events: string[];
  };
  innerWidth: number;
  innerHeight: number;
};
declare const document: { visibilityState: string };

function installTwoPlugins(dataDir: string): void {
  installFixturePlugins(dataDir, [
    fixtureInstall("class-timer"),
    fixtureInstall("attendance"),
  ]);
}

/** A Hub with the two UI-only fixtures installed, its Hub Chrome, and the words it uses. */
async function hubWithTwoPlugins(dataDir: string): Promise<{
  hub: ElectronApplication;
  hubChrome: Page;
  words: Words;
}> {
  installTwoPlugins(dataDir);
  const hub = await launchHub(dataDir);
  const hubChrome = await hub.firstWindow();
  return { hub, hubChrome, words: WORDS[await displayLanguageOf(hubChrome)] };
}

function pluginButton(hubChrome: Page, name: string) {
  return hubChrome.getByRole("button", { name, exact: true });
}

function visibilityOf(page: Page): Promise<string> {
  return page.evaluate(() => document.visibilityState);
}

function eventsOf(page: Page): Promise<string[]> {
  return page.evaluate(() => window.observed.events);
}

test("a UI-only Plugin opens beside the Plugin Switcher with window.hub and <html lang> set before its script ran", async ({
  dataDir,
}) => {
  const { hub, hubChrome, words } = await hubWithTwoPlugins(dataDir);
  try {
    const language = await displayLanguageOf(hubChrome);

    await pluginButton(hubChrome, words.timer).click();

    const timer = await pluginPage(() => hub.windows(), "class-timer");
    expect(
      await timer.evaluate(() => {
        const { displayLanguage, lang, hubKeys, hubFrozen } = window.observed;
        return { displayLanguage, lang, hubKeys, hubFrozen };
      }),
    ).toEqual({
      displayLanguage: language,
      lang: language,
      hubKeys: ["displayLanguage"],
      hubFrozen: true,
    });
    await expect(pluginButton(hubChrome, words.timer)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(hubChrome.getByText(words.noPluginOpen)).toBeHidden();
    // The Plugin UI fills the content area beside the 240 px Plugin Switcher.
    const [contentArea] = await hub.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().map((window) => window.getContentBounds()),
    );
    expect(
      await timer.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      })),
    ).toEqual({
      width: (contentArea?.width ?? 0) - 240,
      height: contentArea?.height,
    });
  } finally {
    await hub.close();
  }
});

test("opening a second Plugin hides the first, and bringing the first forward shows it again", async ({
  dataDir,
}) => {
  installTwoPlugins(dataDir);
  const hub = await launchHubOverCdp(dataDir);
  try {
    const { hubChrome } = hub;
    const words = WORDS[await displayLanguageOf(hubChrome)];
    await pluginButton(hubChrome, words.timer).click();
    const timer = await pluginPage(hub.pages, "class-timer");

    await pluginButton(hubChrome, words.attendance).click();
    const attendance = await pluginPage(hub.pages, "attendance");

    await expect.poll(() => visibilityOf(timer)).toBe("hidden");
    expect(await eventsOf(timer)).toContain("visibilitychange hidden");
    await expect.poll(() => visibilityOf(attendance)).toBe("visible");

    await pluginButton(hubChrome, words.timer).click();

    await expect.poll(() => visibilityOf(timer)).toBe("visible");
    expect(await eventsOf(timer)).toContain("visibilitychange visible");
    await expect.poll(() => visibilityOf(attendance)).toBe("hidden");
    expect(await eventsOf(attendance)).toContain("visibilitychange hidden");
    await expect(pluginButton(hubChrome, words.timer)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(pluginButton(hubChrome, words.attendance)).not.toHaveAttribute(
      "aria-current",
    );
  } finally {
    await hub.close();
  }
});

test("clicking an open Plugin never opens a second copy", async ({
  dataDir,
}) => {
  const { hub, hubChrome, words } = await hubWithTwoPlugins(dataDir);
  try {
    await pluginButton(hubChrome, words.timer).click();
    await pluginPage(() => hub.windows(), "class-timer");

    await pluginButton(hubChrome, words.timer).click();
    await pluginButton(hubChrome, words.attendance).click();
    await pluginPage(() => hub.windows(), "attendance");
    await pluginButton(hubChrome, words.timer).click();

    await expect(pluginButton(hubChrome, words.timer)).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      await hub.evaluate(
        ({ webContents }) =>
          webContents
            .getAllWebContents()
            .filter((contents) =>
              contents.getURL().startsWith("hawkeye-plugin://class-timer/"),
            ).length,
      ),
    ).toBe(1);
  } finally {
    await hub.close();
  }
});

test("closing a Plugin fires its pagehide, removes its view and brings the previous one forward; closing the last shows the empty state", async ({
  dataDir,
}) => {
  installTwoPlugins(dataDir);
  const hub = await launchHubOverCdp(dataDir);
  try {
    const { hubChrome } = hub;
    const words = WORDS[await displayLanguageOf(hubChrome)];
    await pluginButton(hubChrome, words.timer).click();
    const timer = await pluginPage(hub.pages, "class-timer");
    await pluginButton(hubChrome, words.attendance).click();
    await pluginPage(hub.pages, "attendance");
    await expect.poll(() => visibilityOf(timer)).toBe("hidden");

    await hubChrome
      .getByRole("button", { name: words.closeAttendance, exact: true })
      .click();

    // The page is gone by now, so its pagehide is read from the Plugin's log.
    await expect
      .poll(() => pluginLogMessages(dataDir, "attendance"))
      .toContain("pagehide");
    await expect.poll(() => pluginPages(hub.pages(), "attendance")).toEqual([]);
    await expect.poll(() => visibilityOf(timer)).toBe("visible");
    await expect(pluginButton(hubChrome, words.timer)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(hubChrome.getByText(words.noPluginOpen)).toBeHidden();

    await hubChrome
      .getByRole("button", { name: words.closeTimer, exact: true })
      .click();

    await expect(hubChrome.getByText(words.noPluginOpen)).toBeVisible();
    await expect
      .poll(() => pluginLogMessages(dataDir, "class-timer"))
      .toContain("pagehide");
    await expect
      .poll(() => pluginPages(hub.pages(), "class-timer"))
      .toEqual([]);
    await expect(
      hubChrome.getByRole("button", { name: words.closeTimer, exact: true }),
    ).toBeHidden();
  } finally {
    await hub.close();
  }
});

test("quitting the Hub closes every open Plugin", async ({ dataDir }) => {
  const { hub, hubChrome, words } = await hubWithTwoPlugins(dataDir);
  await pluginButton(hubChrome, words.timer).click();
  await pluginPage(() => hub.windows(), "class-timer");
  await pluginButton(hubChrome, words.attendance).click();
  await pluginPage(() => hub.windows(), "attendance");

  await hub.close();

  expect(pluginLogMessages(dataDir, "class-timer")).toContain("pagehide");
  expect(pluginLogMessages(dataDir, "attendance")).toContain("pagehide");
});

// Read from the main process: Playwright's page stays crashed even once the view has reloaded.
function reloadedForeground(hub: ElectronApplication): Promise<unknown[]> {
  return hub.evaluate(({ webContents }) =>
    Promise.all(
      webContents
        .getAllWebContents()
        .filter((contents) => !contents.getURL().startsWith("hawkeye-plugin:"))
        .map((contents): Promise<unknown> =>
          contents.executeJavaScript(
            'Array.from(document.querySelector("hub-chrome")?.shadowRoot?.querySelector("plugin-switcher")?.shadowRoot?.querySelectorAll("[aria-current=page]") ?? [], (button) => button.textContent.trim())',
          ),
        ),
    ),
  );
}

test("crashing the Hub Chrome with a Plugin open leaves it open, and it is listed as open after the reload", async ({
  dataDir,
}) => {
  const { hub, hubChrome, words } = await hubWithTwoPlugins(dataDir);
  try {
    await pluginButton(hubChrome, words.timer).click();
    const timer = await pluginPage(() => hub.windows(), "class-timer");

    await crashHubChrome(hub);

    await expect.poll(() => reloadedForeground(hub)).toEqual([[words.timer]]);
    // Still the same page: it answers, and it never saw a pagehide.
    expect(await eventsOf(timer)).toEqual([]);
    expect(pluginLogMessages(dataDir, "class-timer")).not.toContain("pagehide");
  } finally {
    await hub.close();
  }
});
