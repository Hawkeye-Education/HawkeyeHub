import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  hubLogLines,
  installFixturePlugins,
  launchHub,
  lifecycleLine,
  pluginPage,
  switcherNames,
  test,
} from "./hub";
import { RAIL_WIDTH_PX } from "../src/shared/hub-chrome-ipc";

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

// Seating Plan's star, and the Switcher with it starred, in each Display Language: it moves up
// from the middle in en-HK and from the bottom in zh-HK.
const STARRED = {
  "en-HK": {
    star: "Add Seating Plan to Favourites",
    names: ["Seating Plan", "Attendance", "Timer"],
  },
  "zh-HK": {
    star: "把 Seating Plan 加入我的最愛",
    names: ["Seating Plan", "計時器", "點名"],
  },
};

test("a starred Plugin moves to the top as a Favourite, and stays one after a restart", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [
    fixtureInstall("class-timer"),
    fixtureInstall("seating-plan"),
    fixtureInstall("attendance"),
  ]);

  const hub = await launchHub(dataDir);
  let starred: (typeof STARRED)[keyof typeof STARRED];
  try {
    const hubChrome = await hub.firstWindow();
    starred = STARRED[await displayLanguageOf(hubChrome)];
    await hubChrome
      .getByRole("button", { name: starred.star, exact: true })
      .click();
    await expect.poll(() => switcherNames(hubChrome)).toEqual(starred.names);
  } finally {
    await hub.close();
  }

  const reopened = await launchHub(dataDir);
  try {
    const hubChrome = await reopened.firstWindow();
    await expect.poll(() => switcherNames(hubChrome)).toEqual(starred.names);
  } finally {
    await reopened.close();
  }
});

// For code evaluated in the Plugin UI's page; the smoke suite has no DOM types.
declare const window: { innerWidth: number };

const COLLAPSE = {
  "en-HK": {
    timer: "Timer",
    hide: "Hide Plugin Switcher",
    show: "Show Plugin Switcher",
  },
  "zh-HK": {
    timer: "計時器",
    hide: "隱藏外掛程式切換器",
    show: "顯示外掛程式切換器",
  },
};

test("collapsing the Switcher gives the Plugin UI the freed width, and stays collapsed after a restart", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);

  const hub = await launchHub(dataDir);
  let words: (typeof COLLAPSE)[keyof typeof COLLAPSE];
  try {
    const hubChrome = await hub.firstWindow();
    words = COLLAPSE[await displayLanguageOf(hubChrome)];
    await hubChrome
      .getByRole("button", { name: words.timer, exact: true })
      .click();
    const timer = await pluginPage(() => hub.windows(), "class-timer");
    await hubChrome
      .getByRole("button", { name: words.hide, exact: true })
      .click();
    const [contentArea] = await hub.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().map((window) => window.getContentBounds()),
    );
    if (contentArea === undefined) throw new Error("The Hub has no window");
    await expect
      .poll(() => timer.evaluate(() => window.innerWidth))
      .toBe(contentArea.width - RAIL_WIDTH_PX);
  } finally {
    await hub.close();
  }

  const reopened = await launchHub(dataDir);
  try {
    const hubChrome = await reopened.firstWindow();
    await expect(
      hubChrome.getByRole("button", { name: words.show, exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
  } finally {
    await reopened.close();
  }
});
