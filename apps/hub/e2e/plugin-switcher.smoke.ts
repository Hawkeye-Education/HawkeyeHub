import {
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
