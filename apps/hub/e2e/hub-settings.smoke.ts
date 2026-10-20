// Hub Settings end to end (#73): the Colour Scheme applies only on Save, reaches open Plugin UIs,
// and survives a restart; the Display Language (#75) switches the Hub Chrome on Save and reaches
// Plugins opened after it; a damaged settings file never stops the Hub starting.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  hubLogLines,
  installFixturePlugins,
  launchHub,
  launchHubOverCdp,
  pluginPage,
  test,
  type DisplayLanguage,
} from "./hub";

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
} satisfies Record<DisplayLanguage, unknown>;

// The page's own global, for code evaluated in it; the smoke suite has no DOM types.
declare const matchMedia: (query: string) => { matches: boolean };

function drawsDark(page: Page): Promise<boolean> {
  return page.evaluate(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

// Over CDP: `launchHub` emulates a light `prefers-color-scheme` whatever the Hub sets (probed: a
// saved Dark left matchMedia light). The test picks the scheme the OS is not in, so each check
// below would fail if nothing changed.
test("a Colour Scheme applies on Save, in open Plugin UIs too, and is kept after a restart", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const first = await launchHubOverCdp(dataDir);
  const { hubChrome } = first;
  const words = WORDS[await displayLanguageOf(hubChrome)];
  const osDark = await drawsDark(hubChrome);
  const chosen = osDark ? words.light : words.dark;
  await hubChrome
    .getByRole("button", { name: words.timer, exact: true })
    .click();
  const timer = await pluginPage(first.pages, "class-timer");

  await hubChrome.getByRole("button", { name: words.settings }).click();
  await hubChrome.getByRole("radio", { name: chosen }).check();
  expect(await drawsDark(hubChrome)).toBe(osDark);

  await hubChrome.getByRole("button", { name: words.save }).click();
  await expect.poll(() => drawsDark(hubChrome)).toBe(!osDark);
  await expect.poll(() => drawsDark(timer)).toBe(!osDark);
  await first.close();

  const second = await launchHubOverCdp(dataDir);
  expect(await drawsDark(second.hubChrome)).toBe(!osDark);
  await second.hubChrome.getByRole("button", { name: words.settings }).click();
  await expect(
    second.hubChrome.getByRole("radio", { name: chosen }),
  ).toBeChecked();
  await second.close();
});

const OTHER_LANGUAGE: Record<
  DisplayLanguage,
  { language: DisplayLanguage; name: string }
> = {
  "en-HK": { language: "zh-HK", name: "繁體中文" },
  "zh-HK": { language: "en-HK", name: "English" },
};

const LANGUAGE_NOTE = {
  "en-HK": "Open Plugins switch language when you reopen them.",
  "zh-HK": "已開啟的外掛程式會在重新開啟後轉換語言。",
} satisfies Record<DisplayLanguage, string>;

// The test picks the language the OS is not in, so each check fails if nothing changed.
test("a Display Language switches the Hub Chrome on Save, reaches Plugins opened after, and is kept after a restart", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [
    fixtureInstall("class-timer"),
    fixtureInstall("attendance"),
  ]);
  const first = await launchHub(dataDir);
  const hubChrome = await first.firstWindow();
  const osLanguage = await displayLanguageOf(hubChrome);
  const words = WORDS[osLanguage];
  const other = OTHER_LANGUAGE[osLanguage];
  await hubChrome
    .getByRole("button", { name: words.timer, exact: true })
    .click();
  const timer = await pluginPage(() => first.windows(), "class-timer");

  await hubChrome.getByRole("button", { name: words.settings }).click();
  await hubChrome.getByRole("radio", { name: other.name }).check();
  await hubChrome.getByRole("button", { name: words.save }).click();
  await expect(hubChrome.locator("html")).toHaveAttribute(
    "lang",
    other.language,
  );
  await expect(
    hubChrome.getByText(LANGUAGE_NOTE[other.language]),
  ).toBeVisible();
  // The open Plugin keeps the language it was opened with (ADR 0007).
  await expect(timer.locator("html")).toHaveAttribute("lang", osLanguage);

  const otherWords = WORDS[other.language];
  await hubChrome
    .getByRole("button", { name: otherWords.timer, exact: true })
    .click();
  await expect(hubChrome.getByText(LANGUAGE_NOTE[other.language])).toBeHidden();
  await hubChrome.getByRole("button", { name: otherWords.settings }).click();
  await expect(hubChrome.getByText(LANGUAGE_NOTE[other.language])).toBeHidden();
  const attendanceName = other.language === "zh-HK" ? "點名" : "Attendance";
  await hubChrome
    .getByRole("button", { name: attendanceName, exact: true })
    .click();
  const attendance = await pluginPage(() => first.windows(), "attendance");
  await expect(attendance.locator("html")).toHaveAttribute(
    "lang",
    other.language,
  );
  await first.close();

  const second = await launchHub(dataDir);
  expect(await displayLanguageOf(await second.firstWindow())).toBe(
    other.language,
  );
  await second.close();
});

test("a settings file that is not JSON is logged and replaced, and the Hub starts", async ({
  dataDir,
}) => {
  // The Hub's data folder is HAWKEYE_HUB_DATA_DIR itself.
  const file = join(dataDir, "hub-settings.json");
  writeFileSync(file, "{ colourScheme: dark");
  const hub = await launchHub(dataDir);
  await expect(
    (await hub.firstWindow()).getByText("Hawkeye Hub"),
  ).toBeVisible();

  expect(hubLogLines(dataDir)).toContainEqual(
    expect.objectContaining({
      level: "warn",
      message: "Hub Settings replaced with first-launch values: not JSON",
    }),
  );
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
    theme: { kind: "company" },
    colourScheme: "system",
    displayLanguage: { kind: "system" },
  });
  await hub.close();
});

test("a stored Theme this Hub does not have shows Hawkeye, is logged once, and stays stored", async ({
  dataDir,
}) => {
  const file = join(dataDir, "hub-settings.json");
  const stored = {
    theme: { kind: "chosen", name: "aurora" },
    colourScheme: "system",
    displayLanguage: { kind: "system" },
  };
  writeFileSync(file, JSON.stringify(stored));
  const hub = await launchHub(dataDir);
  const hubChrome = await hub.firstWindow();
  const words = WORDS[await displayLanguageOf(hubChrome)];

  await hubChrome.getByRole("button", { name: words.settings }).click();
  await expect(hubChrome.getByRole("radio", { name: "Hawkeye" })).toBeChecked();
  const unknownTheme = "Theme aurora unknown to this Hub, using hawkeye";
  const lines = hubLogLines(dataDir);
  expect(lines).toContainEqual(
    expect.objectContaining({ level: "warn", message: unknownTheme }),
  );
  expect(
    lines.filter((line) => JSON.stringify(line).includes(unknownTheme)),
  ).toHaveLength(1);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(stored);
  await hub.close();
});
