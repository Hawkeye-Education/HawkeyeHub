import { existsSync, readdirSync } from "node:fs";
import { homedir, release } from "node:os";
import { join } from "node:path";
import { windowBackdrop } from "../src/main/platform";
import { displayLanguageOf, exitCodeOf, expect, launchHub, test } from "./hub";

test("the Hub shows one window whose Hub Chrome says Hawkeye Hub", async ({
  hub,
}) => {
  const hubChrome = await hub.firstWindow();

  await expect(
    hubChrome.getByRole("banner").getByText("Hawkeye Hub"),
  ).toBeVisible();
  const titles = await hub.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows().map((window) => window.getTitle()),
  );
  expect(titles).toEqual(["Hawkeye Hub"]);
});

test("the Hub Chrome has no Node access", async ({ hub }) => {
  const hubChrome = await hub.firstWindow();

  const nodeGlobals = await hubChrome.evaluate(() =>
    ["require", "process", "module", "Buffer"].filter(
      (name) => name in globalThis,
    ),
  );
  expect(nodeGlobals).toEqual([]);
});

test("closing the window quits the Hub", async ({ hub }) => {
  await hub.firstWindow();
  const exitCode = exitCodeOf(hub);

  await hub.evaluate(({ BaseWindow }) => {
    for (const window of BaseWindow.getAllWindows()) window.close();
  });

  expect(await exitCode).toBe(0);
});

// Where Electron puts the Hub's user data and logs for the OS user when there is no data folder,
// on the platforms the smoke suite runs on.
function defaultHubFolders(): string[] {
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    if (appData === undefined) throw new Error("APPDATA is not set");
    // The default logs folder is inside the default user data folder.
    return [join(appData, "Hawkeye Hub")];
  }
  if (process.platform === "darwin") {
    return [
      join(homedir(), "Library", "Application Support", "Hawkeye Hub"),
      join(homedir(), "Library", "Logs", "Hawkeye Hub"),
    ];
  }
  throw new Error(`no default Hub folders known for ${process.platform}`);
}

// Launches the Hub itself: the `hub` fixture would start it before the default folders are checked.
test("the Hub keeps its user data and logs under HAWKEYE_HUB_DATA_DIR", async ({
  dataDir,
}) => {
  // A folder left by a Hub run without a data folder cannot show whether this run wrote to it.
  const absentDefaults = defaultHubFolders().filter((folder) => {
    if (!existsSync(folder)) return true;
    test.info().annotations.push({
      type: "skipped check",
      description: `${folder} already existed`,
    });
    return false;
  });

  const hub = await launchHub(dataDir);
  try {
    await hub.firstWindow();
  } finally {
    await hub.close();
  }

  expect(readdirSync(join(dataDir, "user-data"))).not.toEqual([]);
  expect(existsSync(join(dataDir, "logs", "hub.log"))).toBe(true);
  expect(absentDefaults.filter((folder) => existsSync(folder))).toEqual([]);
});

// The Hub Chrome's global, for code evaluated in its page; the smoke suite has no DOM types.
declare const window: { innerWidth: number; innerHeight: number };

test("the Hub Chrome fills the maximised window", async ({ hub }) => {
  const hubChrome = await hub.firstWindow();

  await hub.evaluate(({ BaseWindow }) => {
    for (const window of BaseWindow.getAllWindows()) window.maximize();
  });

  // Both sizes read on each poll: maximising animates on macOS, so the content area settles late.
  await expect
    .poll(async () => {
      const contentAreas = await hub.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows().map((window) => ({
          maximised: window.isMaximized(),
          width: window.getContentBounds().width,
          height: window.getContentBounds().height,
        })),
      );
      const page = await hubChrome.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      return contentAreas.map(({ maximised, width, height }) => ({
        maximised,
        widthGap: width - page.width,
        heightGap: height - page.height,
      }));
    })
    .toEqual([{ maximised: true, widthGap: 0, heightGap: 0 }]);
});

const DARK_TINT = "#0c0c0c";

const DARK_WORDS = {
  "en-HK": { settings: "Settings", dark: "Dark", save: "Save" },
  "zh-HK": { settings: "設定", dark: "深色", save: "儲存" },
};

// Every view is transparent, so behind the Hub Chrome is the window's own background (ADR 0006).
// `launchHub` keeps its pages light whatever the Hub sets (hub-settings.smoke.ts), but not main.
test("a saved Dark paints the window's tint dark behind the Hub Chrome", async ({
  hub,
}) => {
  test.skip(
    windowBackdrop(process.platform, release()) !== "tint",
    "This OS shows its own material, not the Theme's tint",
  );
  const hubChrome = await hub.firstWindow();
  const words = DARK_WORDS[await displayLanguageOf(hubChrome)];

  await hubChrome.getByRole("button", { name: words.settings }).click();
  await hubChrome.getByRole("radio", { name: words.dark }).check();
  await hubChrome.getByRole("button", { name: words.save }).click();

  await expect
    .poll(() =>
      hub.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows().map((window) =>
          window.getBackgroundColor().toLowerCase(),
        ),
      ),
    )
    .toEqual([DARK_TINT]);
});
