// The packaged Hub (#119): `pnpm package`'s unpacked build runs without the repo, its Hub Chrome
// and preloads loading from the app bundle. Slow, since it needs `pnpm package` first, so it runs
// only where HAWKEYE_HUB_PACKAGED=1, which CI sets on its Windows runner after packaging.

import { join } from "node:path";
import { _electron } from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  HUB_DIR,
  hubEnv,
  hubLogLines,
  lifecycleLine,
  test,
} from "./hub";

const PACKAGED_HUB = join(HUB_DIR, "dist", "win-unpacked", "Hawkeye Hub.exe");

const WORDS = {
  "en-HK": {
    catalogue: "Plugin Catalogue",
    noPlugins: "The Registry offers no Plugins",
    settings: "Settings",
    save: "Save",
  },
  "zh-HK": {
    catalogue: "外掛程式目錄",
    noPlugins: "外掛程式庫未有提供任何外掛程式",
    settings: "設定",
    save: "儲存",
  },
};

test.skip(
  process.env["HAWKEYE_HUB_PACKAGED"] !== "1",
  "needs `pnpm package` first: set HAWKEYE_HUB_PACKAGED=1",
);

test("the packaged Hub shows the Plugin Catalogue and Hub Settings, and logs to hub.log", async ({
  dataDir,
}) => {
  const hub = await _electron.launch({
    executablePath: PACKAGED_HUB,
    args: [],
    env: hubEnv(dataDir),
  });
  try {
    const hubChrome = await hub.firstWindow();
    const words = WORDS[await displayLanguageOf(hubChrome)];

    await hubChrome.getByRole("button", { name: words.catalogue }).click();
    await expect(hubChrome.locator("plugin-catalogue")).toContainText(
      words.noPlugins,
    );
    await hubChrome.getByRole("button", { name: words.settings }).click();
    await expect(
      hubChrome.getByRole("button", { name: words.save }),
    ).toBeVisible();
  } finally {
    await hub.close();
  }
  expect(hubLogLines(dataDir)).toContainEqual(lifecycleLine("Hub opened"));
});
