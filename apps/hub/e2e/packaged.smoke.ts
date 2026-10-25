// The packaged Hub (#119): `pnpm package`'s unpacked build runs without the repo, its Hub Chrome
// and preloads loading from the app bundle. Slow, since it needs `pnpm package` first, so it runs
// only where HAWKEYE_HUB_PACKAGED=1, which CI sets on its Windows runner after packaging. A Plugin UI
// gets the Hub Kit fonts from the bundle too (#121).

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  HUB_DIR,
  hubEnv,
  hubLogLines,
  installFixturePlugins,
  lifecycleLine,
  pluginPage,
  test,
} from "./hub";

// The page's own globals, for code evaluated in it; the smoke suite has no DOM types.
declare const document: {
  fonts: { load(font: string, text: string): Promise<readonly object[]> };
};

// The build runs from a copy outside the repo, as an installed Hub does. Node looks for a package in
// every parent folder's node_modules, so from dist/ the build finds what it failed to pack in the
// repo's node_modules, as zod went missing from 0.1.0 (#129).
let packagedDir: string;
let PACKAGED_HUB: string;
test.beforeAll(() => {
  packagedDir = mkdtempSync(join(tmpdir(), "hawkeye-hub-packaged-"));
  cpSync(join(HUB_DIR, "dist", "win-unpacked"), packagedDir, {
    recursive: true,
  });
  PACKAGED_HUB = join(packagedDir, "Hawkeye Hub.exe");
});
test.afterAll(() => {
  rmSync(packagedDir, { recursive: true, force: true });
});

const WORDS = {
  "en-HK": {
    catalogue: "Plugin Catalogue",
    noPlugins: "The Registry offers no Plugins",
    settings: "Settings",
    save: "Save",
    timer: "Timer",
  },
  "zh-HK": {
    catalogue: "外掛程式目錄",
    noPlugins: "外掛程式庫未有提供任何外掛程式",
    settings: "設定",
    save: "儲存",
    timer: "計時器",
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

test("a Plugin UI in the packaged Hub loads the Hub Kit fonts from the app bundle", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const hub = await _electron.launch({
    executablePath: PACKAGED_HUB,
    args: [],
    env: hubEnv(dataDir),
  });
  try {
    const hubChrome = await hub.firstWindow();
    const words = WORDS[await displayLanguageOf(hubChrome)];
    await hubChrome
      .getByRole("button", { name: words.timer, exact: true })
      .click();
    const timer = await pluginPage(() => hub.windows(), "class-timer");

    // A face loads only when its file does, so an empty answer is a font that failed to load.
    const loaded = await timer.evaluate(() =>
      Promise.all([
        document.fonts.load("16px Inter", "Hub"),
        document.fonts.load('16px "Noto Sans TC"', "計時器"),
      ]).then((faces) => faces.map((face) => face.length)),
    );
    expect(loaded).toEqual([1, 1]);
  } finally {
    await hub.close();
  }
});
