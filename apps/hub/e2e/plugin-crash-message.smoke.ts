// A Plugin that closes as crashed or failed to start tells staff so, on the dialog overlay, with
// Export diagnostics and OK (#29). Reuses #53's crash fixtures.

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import {
  bundleEntries,
  crashSummaries,
  displayLanguageOf,
  EXPORT_DIAGNOSTICS_WORDS,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  linesOf,
  overlay,
  overlayShowing,
  pluginPage,
  press,
  stubSaveDialog,
  test,
  type BackendFixtureWindow,
  type DisplayLanguage,
} from "./hub";

// What the crash message says, in each Display Language.
const WORDS = {
  "en-HK": {
    stopped: (name: string) => `${name} stopped unexpectedly`,
    crashed: "It crashed.",
    failedToStart: "It failed to start.",
    export: EXPORT_DIAGNOSTICS_WORDS["en-HK"],
    ok: "OK",
  },
  "zh-HK": {
    stopped: (name: string) => `${name} 意外停止運作`,
    crashed: "它當機了。",
    failedToStart: "它無法啟動。",
    export: EXPORT_DIAGNOSTICS_WORDS["zh-HK"],
    ok: "確定",
  },
} satisfies Record<DisplayLanguage, unknown>;

declare const window: BackendFixtureWindow;
declare const console: Record<
  "debug" | "log" | "info" | "warn" | "error",
  (message: string) => void
>;

async function hubWith(
  dataDir: string,
  fixtures: string[],
): Promise<{
  hub: ElectronApplication;
  hubChrome: Page;
  language: DisplayLanguage;
}> {
  installFixturePlugins(dataDir, fixtures.map(fixtureInstall));
  const hub = await launchHub(dataDir);
  const hubChrome = await hub.firstWindow();
  return { hub, hubChrome, language: await displayLanguageOf(hubChrome) };
}

/** The crash message on the dialog overlay, once it is showing. */
async function crashMessage(hub: ElectronApplication): Promise<Locator> {
  return (await overlay(hub)).getByRole("dialog");
}

test("a Backend that exits mid-request shows the crashed message, whose Export diagnostics saves the Plugin's UI and Backend lines and no debug line, and OK dismisses it", async ({
  dataDir,
}) => {
  const { hub, hubChrome, language } = await hubWith(dataDir, [
    "crashing-backend",
  ]);
  const words = WORDS[language];
  try {
    await hubChrome
      .getByRole("button", { name: "Crashing", exact: true })
      .click();
    const page = await pluginPage(() => hub.windows(), "crashing-backend");

    await page.evaluate(() => {
      console.debug("ui debug");
      console.log("ui log");
      console.info("ui info");
      console.warn("ui warn");
      console.error("ui error");
      void window.hub.backend.request("fail-loudly", {});
    });

    const dialog = await crashMessage(hub);
    await expect(dialog.getByRole("heading")).toHaveText(
      words.stopped("Crashing"),
    );
    await expect(dialog).toContainText(words.crashed);
    // OK and Export diagnostics, and no Reopen.
    await expect(dialog.getByRole("button")).toHaveText([
      words.ok,
      words.export,
    ]);

    const destination = join(
      mkdtempSync(join(tmpdir(), "hawkeye-hub-export-")),
      "bundle.zip",
    );
    await stubSaveDialog(hub, { canceled: false, filePath: destination });
    await dialog.getByRole("button", { name: words.export }).click();

    await expect.poll(() => existsSync(destination)).toBe(true);
    const lines = linesOf(
      bundleEntries(destination)["plugins/crashing-backend.log"],
    );
    const line = (
      source: "ui" | "backend",
      level: string,
      message: string,
    ) => ({
      time: expect.any(String),
      source,
      level,
      message,
      pluginId: "crashing-backend",
      pluginVersion: "1.0.0",
    });
    // Only the fixture's own lines: an unpackaged Hub's Plugin UI also logs Electron's warnings.
    expect(
      lines.filter(
        (each) =>
          typeof each === "object" &&
          each !== null &&
          "message" in each &&
          typeof each.message === "string" &&
          /^(ui|backend) /.test(each.message),
      ),
    ).toEqual([
      line("ui", "info", "ui log"),
      line("ui", "info", "ui info"),
      line("ui", "warn", "ui warn"),
      line("ui", "error", "ui error"),
      line("backend", "stderr", "backend failing loudly"),
    ]);
    expect(JSON.stringify(lines)).not.toContain("ui debug");

    // Exporting leaves the message up; OK takes it away.
    await expect(dialog).toBeVisible();
    await press(dialog.getByRole("button", { name: words.ok }));
    await expect.poll(() => overlayShowing(hub)).toBe(false);
  } finally {
    await hub.close();
  }
});

test("a Backend whose initialize rejects shows the failed to start message", async ({
  dataDir,
}) => {
  const { hub, hubChrome, language } = await hubWith(dataDir, [
    "rejecting-backend",
  ]);
  const words = WORDS[language];
  try {
    await hubChrome
      .getByRole("button", { name: "Rejecting", exact: true })
      .click();

    const dialog = await crashMessage(hub);
    await expect(dialog.getByRole("heading")).toHaveText(
      words.stopped("Rejecting"),
    );
    await expect(dialog).toContainText(words.failedToStart);
  } finally {
    await hub.close();
  }
});

for (const language of ["en-HK", "zh-HK"] as const) {
  test(`the message reads in ${language} when that is the Display Language`, async ({
    dataDir,
  }) => {
    writeFileSync(
      join(dataDir, "hub-settings.json"),
      JSON.stringify({
        theme: { kind: "company" },
        colourScheme: "system",
        displayLanguage: { kind: "chosen", language },
        aiProviders: [],
        defaultAiProvider: { kind: "none" },
      }),
    );
    const { hub, hubChrome } = await hubWith(dataDir, ["rejecting-backend"]);
    const words = WORDS[language];
    try {
      await hubChrome
        .getByRole("button", { name: "Rejecting", exact: true })
        .click();

      const dialog = await crashMessage(hub);
      await expect(dialog.getByRole("heading")).toHaveText(
        words.stopped("Rejecting"),
      );
      await expect(dialog).toContainText(words.failedToStart);
      await expect(dialog.getByRole("button")).toHaveText([
        words.ok,
        words.export,
      ]);
    } finally {
      await hub.close();
    }
  });
}

test("two Plugins crashing together show two messages, one after the other", async ({
  dataDir,
}) => {
  const { hub, hubChrome, language } = await hubWith(dataDir, [
    "crashing-backend",
    "echo-backend",
  ]);
  const words = WORDS[language];
  try {
    for (const name of ["Crashing", "Echo"]) {
      await hubChrome.getByRole("button", { name, exact: true }).click();
    }
    await pluginPage(() => hub.windows(), "crashing-backend");
    await pluginPage(() => hub.windows(), "echo-backend");

    await hub.evaluate(({ webContents }) => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.getURL().startsWith("hawkeye-plugin:")) {
          contents.forcefullyCrashRenderer();
        }
      }
    });

    // Each renderer's crash arrives on its own, so wait until both are recorded, and so queued,
    // before answering the first: its OK would otherwise take the overlay away first.
    await expect
      .poll(
        () =>
          [
            ...crashSummaries(dataDir, "crashing-backend"),
            ...crashSummaries(dataDir, "echo-backend"),
          ].length,
      )
      .toBe(2);

    // The second message follows the first on the same overlay, so OK on the first is a click;
    // the last one's takes the overlay away, so it is pressed.
    const dialog = await crashMessage(hub);
    await expect(dialog).toContainText(words.crashed);
    const first = await dialog.getByRole("heading").innerText();
    await dialog.getByRole("button", { name: words.ok }).click();
    await expect(dialog.getByRole("heading")).not.toHaveText(first);
    await expect(dialog).toContainText(words.crashed);
    const second = await dialog.getByRole("heading").innerText();
    await press(dialog.getByRole("button", { name: words.ok }));
    expect([first, second].sort()).toEqual(
      [words.stopped("Crashing"), words.stopped("Echo")].sort(),
    );
    await expect.poll(() => overlayShowing(hub)).toBe(false);
  } finally {
    await hub.close();
  }
});
