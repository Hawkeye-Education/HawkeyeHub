// Hub Kit v1's tokens, native-element stylesheet and fonts in a Plugin UI (#121, ADR 0006): there
// before the page's first script, following the Colour Scheme live, and the fonts served from the
// Hub's own files. The token values are Theme A of `prototype/hawkeye-theme`.

import type { Page } from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHubOverCdp,
  pluginPage,
  test,
} from "./hub";

// The page's own globals, for code evaluated in it; the smoke suite has no DOM types.
declare const matchMedia: (query: string) => { matches: boolean };
declare const document: {
  documentElement: object;
  createElement(tag: "button"): {
    dataset: Record<string, string>;
    textContent: string;
  };
  body: { append(...nodes: object[]): void };
  fonts: { load(font: string, text: string): Promise<readonly object[]> };
};
declare const getComputedStyle: (element: object) => {
  getPropertyValue(name: string): string;
  backgroundColor: string;
};
declare const window: { observed: { hubAccent: string } };

const ACCENT = { light: "#c2410c", dark: "#ff8a5c" };

const WORDS = {
  "en-HK": {
    timer: "Timer",
    settings: "Settings",
    light: "Light",
    dark: "Dark",
    save: "Save",
  },
  "zh-HK": {
    timer: "計時器",
    settings: "設定",
    light: "淺色",
    dark: "深色",
    save: "儲存",
  },
};

function accentOf(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--hub-color-accent")
      .trim(),
  );
}

// Over CDP, as hub-settings.smoke.ts explains: the test picks the scheme the OS is not in.
test("a Plugin UI gets the Hub Kit tokens, stylesheet and fonts, and its tokens follow the Colour Scheme live", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const hub = await launchHubOverCdp(dataDir);
  const { hubChrome } = hub;
  const words = WORDS[await displayLanguageOf(hubChrome)];
  const osDark = await hubChrome.evaluate(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [before, after] = osDark
    ? (["dark", "light"] as const)
    : (["light", "dark"] as const);
  await hubChrome
    .getByRole("button", { name: words.timer, exact: true })
    .click();
  const timer = await pluginPage(hub.pages, "class-timer");

  // Read by the fixture's first script, before any other code on the page.
  expect(await timer.evaluate(() => window.observed.hubAccent)).toBe(
    ACCENT[before],
  );

  const [primary, plain] = await timer.evaluate(() => {
    const buttons = ["primary", "plain"].map((variant) => {
      const button = document.createElement("button");
      if (variant === "primary") button.dataset["variant"] = "primary";
      button.textContent = variant;
      return button;
    });
    document.body.append(...buttons);
    return buttons.map((button) => getComputedStyle(button).backgroundColor);
  });
  expect(primary).not.toBe(plain);

  // A face loads only when its file does, so an empty answer is a font that failed to load.
  const loaded = await timer.evaluate(() =>
    Promise.all([
      document.fonts.load("16px Inter", "Hub"),
      document.fonts.load('16px "Noto Sans TC"', "計時器"),
    ]).then((faces) => faces.map((face) => face.length)),
  );
  expect(loaded).toEqual([1, 1]);

  await hubChrome.getByRole("button", { name: words.settings }).click();
  await hubChrome.getByRole("radio", { name: words[after] }).check();
  await hubChrome.getByRole("button", { name: words.save }).click();
  await expect.poll(() => accentOf(timer)).toBe(ACCENT[after]);
  await hub.close();
});
