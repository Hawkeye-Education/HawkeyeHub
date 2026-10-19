// Plugins the Hub cannot run are listed with the reason and do not open (#49).

import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  pluginPage,
  test,
  type DisplayLanguage,
} from "./hub";

// What the Hub Chrome says, in each Display Language; the Hub follows the OS's.
const WORDS = {
  "en-HK": {
    timer: "Timer",
    gradebook: "Gradebook",
    library: "Library",
    needsSignIn: "Needs sign-in",
    needsDifferentHub: "Needs a different Hub",
    noPluginOpen: "No Plugin is open",
  },
  "zh-HK": {
    timer: "計時器",
    gradebook: "成績表",
    library: "圖書館",
    needsSignIn: "需要登入",
    needsDifferentHub: "需要另一版本的 Hawkeye Hub",
    noPluginOpen: "未有開啟任何外掛程式",
  },
} satisfies Record<DisplayLanguage, unknown>;

test("an identity-required Plugin and one needing another Hub API are listed with their reasons, and clicking either opens nothing", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [
    fixtureInstall("sign-in-required"),
    fixtureInstall("future-hub-api"),
    fixtureInstall("class-timer"),
  ]);
  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    const words = WORDS[await displayLanguageOf(hubChrome)];
    const item = (name: string) =>
      hubChrome.getByRole("listitem").filter({ hasText: name });

    await expect(item(words.gradebook)).toContainText(words.needsSignIn);
    await expect(item(words.library)).toContainText(words.needsDifferentHub);
    await expect(item(words.timer)).not.toContainText(words.needsSignIn);
    await expect(item(words.timer)).not.toContainText(words.needsDifferentHub);

    await item(words.gradebook).getByText(words.gradebook).click();
    await item(words.library).getByText(words.library).click();
    await expect(hubChrome.getByText(words.noPluginOpen)).toBeVisible();

    // Opening an openable Plugin after the clicks: had either click opened anything, its view
    // would exist by the time this one's does.
    await item(words.timer).getByText(words.timer).click();
    await pluginPage(() => hub.windows(), "class-timer");
    expect(
      await hub.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .map((contents) => contents.getURL())
          .filter((url) => url.startsWith("hawkeye-plugin:")),
      ),
    ).toEqual(["hawkeye-plugin://class-timer/index.html"]);
  } finally {
    await hub.close();
  }
});
