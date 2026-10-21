// Export diagnostics from Hub Settings (#28): the save dialog's file holds every log plus
// system.json, and cancelling it writes nothing.

import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  BUNDLE_FILE_NAME,
  bundleEntries,
  displayLanguageOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  pluginPage,
  stubSaveDialog,
  test,
  type DisplayLanguage,
} from "./hub";

// The fixture Plugin UI's globals, for code evaluated in its page.
declare const window: {
  hub: {
    backend: { request(method: string, params: unknown): Promise<unknown> };
  };
};
declare const console: { log(message: string): void };

const WORDS = {
  "en-HK": { settings: "Settings", export: "Export diagnostics" },
  "zh-HK": { settings: "設定", export: "匯出診斷資料" },
} satisfies Record<DisplayLanguage, unknown>;

async function exportFromSettings(hubChrome: Page): Promise<void> {
  const words = WORDS[await displayLanguageOf(hubChrome)];
  await hubChrome.getByRole("button", { name: words.settings }).click();
  await hubChrome.getByRole("button", { name: words.export }).click();
}

function linesOf(log: string | undefined): unknown[] {
  return (log ?? "")
    .trimEnd()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
}

function pluginLine(source: "ui" | "backend", message: string): unknown {
  return {
    time: expect.any(String),
    source,
    level: source === "ui" ? "info" : "stderr",
    message,
    pluginId: "echo-backend",
    pluginVersion: "1.0.0",
  };
}

test("Export diagnostics in Hub Settings saves every log and system.json, with a Plugin's UI and Backend lines interleaved", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("echo-backend")]);
  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    const language = await displayLanguageOf(hubChrome);
    await hubChrome.getByRole("button", { name: "Echo", exact: true }).click();
    const echo = await pluginPage(() => hub.windows(), "echo-backend");
    await echo.evaluate(async () => {
      console.log("ui one");
      await window.hub.backend.request("say", { text: "backend two" });
      console.log("ui three");
    });
    const destination = join(
      mkdtempSync(join(tmpdir(), "hawkeye-hub-export-")),
      "bundle.zip",
    );
    const saveDialogsShown = await stubSaveDialog(hub, {
      canceled: false,
      filePath: destination,
    });

    await exportFromSettings(hubChrome);

    await expect.poll(() => existsSync(destination)).toBe(true);
    expect(await saveDialogsShown()).toEqual([
      expect.stringMatching(BUNDLE_FILE_NAME),
    ]);
    const entries = bundleEntries(destination);
    expect(Object.keys(entries).sort()).toEqual([
      "hub.log",
      "plugins/echo-backend.log",
      "system.json",
    ]);
    expect(
      linesOf(entries["plugins/echo-backend.log"]).filter(
        (line) =>
          typeof line === "object" &&
          line !== null &&
          "message" in line &&
          typeof line.message === "string" &&
          /^(ui|backend) /.test(line.message),
      ),
    ).toEqual([
      pluginLine("ui", "ui one"),
      pluginLine("backend", "backend two"),
      pluginLine("ui", "ui three"),
    ]);
    expect(JSON.parse(entries["system.json"] ?? "")).toEqual({
      hubVersion: "0.1.0",
      os: {
        name: process.platform,
        version: expect.any(String),
        arch: process.arch,
      },
      displayLanguage: language,
      theme: expect.any(String),
      colourScheme: "system",
      plugins: [{ id: "echo-backend", version: "1.0.0" }],
      pythonVersions: [],
      aiProviders: [],
      authProvider: { kind: "none" },
    });
  } finally {
    await hub.close();
  }
});

test("cancelling the save dialog writes nothing", async ({ hub }) => {
  const hubChrome = await hub.firstWindow();
  const folder = mkdtempSync(join(tmpdir(), "hawkeye-hub-export-"));
  const saveDialogsShown = await stubSaveDialog(hub, {
    canceled: true,
    filePath: join(folder, "bundle.zip"),
  });

  await exportFromSettings(hubChrome);

  await expect.poll(saveDialogsShown).toHaveLength(1);
  // A later main-process task, so the handler has finished with the answer.
  await hub.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
  expect(readdirSync(folder)).toEqual([]);
});
