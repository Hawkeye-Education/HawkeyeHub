import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";
import {
  crashHubChrome,
  displayLanguageOf,
  expect,
  fixtureInstall,
  hubLogLines,
  installFixturePlugins,
  launchHub,
  lifecycleLine,
  switcherNames,
  test,
} from "./hub";

function leftOutLine(id: string, message: string): unknown {
  return {
    time: expect.any(String),
    source: "hub",
    level: "warn",
    message,
    pluginId: id,
    pluginVersion: "1.0.0",
  };
}

// The fixtures' names in each Display Language, sorted as the Hub sorts them: zh-HK puts Han,
// by stroke count, before Latin. Seating Plan has no zh-HK name, so it falls back to English.
const SORTED_NAMES = {
  "en-HK": ["Attendance", "Seating Plan", "Timer"],
  "zh-HK": ["計時器", "點名", "Seating Plan"],
};
const SORTED_WITHOUT_TIMER = {
  "en-HK": ["Attendance", "Seating Plan"],
  "zh-HK": ["點名", "Seating Plan"],
};
const NO_PLUGIN_OPEN = {
  "en-HK": "No Plugin is open",
  "zh-HK": "未有開啟任何外掛程式",
};

test("the Plugin Switcher lists installed Plugins by name, leaving out and logging broken entries", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [
    fixtureInstall("class-timer"),
    fixtureInstall("invalid-manifest"),
    fixtureInstall("seating-plan"),
    // The class-timer fixture, whose Manifest says another id.
    { fixture: "class-timer", id: "lesson-timer", version: "1.0.0" },
    fixtureInstall("attendance"),
  ]);

  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    const language = await displayLanguageOf(hubChrome);
    await expect
      .poll(() => switcherNames(hubChrome))
      .toEqual(SORTED_NAMES[language]);
  } finally {
    await hub.close();
  }

  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    leftOutLine("invalid-manifest", "Plugin left out: Manifest invalid"),
    leftOutLine(
      "lesson-timer",
      "Plugin left out: Manifest disagrees with the record",
    ),
    lifecycleLine("Hub closing"),
  ]);
});

test("with no record the Hub lists no Plugins and writes an empty record", async ({
  hub,
  dataDir,
}) => {
  const hubChrome = await hub.firstWindow();
  const language = await displayLanguageOf(hubChrome);

  await expect(hubChrome.getByText(NO_PLUGIN_OPEN[language])).toBeVisible();
  expect(await switcherNames(hubChrome)).toEqual([]);
  expect(
    JSON.parse(readFileSync(join(dataDir, "installed-plugins.json"), "utf8")),
  ).toEqual([]);
});

// Read from the main process: Playwright's page stays crashed even once the view has reloaded.
function reloadedSwitcherNames(hub: ElectronApplication): Promise<unknown[]> {
  return hub.evaluate(({ webContents }) =>
    Promise.all(
      webContents
        .getAllWebContents()
        .map((contents): Promise<unknown> =>
          contents.executeJavaScript(
            'Array.from(document.querySelector("hub-chrome")?.shadowRoot?.querySelector("plugin-switcher")?.shadowRoot?.querySelectorAll("li") ?? [], (li) => li.textContent)',
          ),
        ),
    ),
  );
}

test("after the Hub Chrome crashes and reloads, the Plugin Switcher lists the same Plugins", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [
    fixtureInstall("seating-plan"),
    fixtureInstall("attendance"),
  ]);
  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    const expected = SORTED_WITHOUT_TIMER[await displayLanguageOf(hubChrome)];
    await expect.poll(() => switcherNames(hubChrome)).toEqual(expected);

    await crashHubChrome(hub);

    await expect.poll(() => reloadedSwitcherNames(hub)).toEqual([expected]);
  } finally {
    await hub.close();
  }
});
