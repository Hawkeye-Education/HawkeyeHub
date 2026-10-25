// Hub Kit v1's components in a Plugin UI (#122, ADR 0010): `<hub-folder-field>` picks a folder
// through `hub.files.pickFolder`, whose dialog is stubbed in main, and its Browse… button is in the
// Display Language. `<hub-log>` colours each tone from its token and keeps the newest line in view.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";
import {
  type DisplayLanguage,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  pluginPage,
  test,
} from "./hub";

type FolderFieldValue = { kind: "none" } | { kind: "chosen"; path: string };
type Tone = "info" | "success" | "danger";

// The page's own globals, for code evaluated in it; the smoke suite has no DOM types.
interface Styled {
  style: { color: string; height: string };
}
declare const document: {
  createElement(tag: "hub-folder-field"): Styled & {
    label: string;
    value: FolderFieldValue;
    addEventListener(type: "change", listener: () => void): void;
  };
  createElement(tag: "hub-log"): Styled & {
    append(line: { tone: Tone; text: string }): void;
    clear(): void;
  };
  createElement(tag: "span"): Styled;
  body: { append(node: object): void };
};
interface Measured {
  getBoundingClientRect(): { height: number };
}
declare const getComputedStyle: (element: object) => { color: string };
declare const window: {
  changes: FolderFieldValue[];
  field: { value: FolderFieldValue };
  log: { clear(): void };
};

const WORDS = {
  "en-HK": { timer: "Timer", browse: "Browse…" },
  "zh-HK": { timer: "計時器", browse: "瀏覽…" },
} satisfies Record<DisplayLanguage, { timer: string; browse: string }>;

async function openTimerIn(dataDir: string, language: DisplayLanguage) {
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
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const hub = await launchHub(dataDir);
  const hubChrome = await hub.firstWindow();
  await hubChrome
    .getByRole("button", { name: WORDS[language].timer, exact: true })
    .click();
  return { hub, timer: await pluginPage(() => hub.windows(), "class-timer") };
}

/** Answers the folder dialogs with `answers`, in order, and returns the titles they were shown with. */
async function stubOpenDialogs(
  hub: ElectronApplication,
  answers: { canceled: boolean; filePaths: string[] }[],
): Promise<() => Promise<string[]>> {
  await hub.evaluate(({ dialog }, answers) => {
    const titles: string[] = [];
    (globalThis as unknown as { titles: string[] }).titles = titles;
    dialog.showOpenDialog = (...args: unknown[]) => {
      // Called as (window, options).
      titles.push((args.at(-1) as { title: string }).title);
      const answer = answers.shift();
      if (answer === undefined) throw new Error("One dialog too many");
      return Promise.resolve({ ...answer, bookmarks: [] });
    };
  }, answers);
  return () =>
    hub.evaluate(() => (globalThis as unknown as { titles: string[] }).titles);
}

for (const language of ["en-HK", "zh-HK"] as const) {
  test(`<hub-folder-field> picks a folder with its ${language} Browse… button and fires change`, async ({
    dataDir,
  }) => {
    const { hub, timer } = await openTimerIn(dataDir, language);
    try {
      await timer.evaluate(() => {
        const field = document.createElement("hub-folder-field");
        field.label = "Input folder";
        window.changes = [];
        field.addEventListener("change", () => {
          window.changes.push(field.value);
        });
        window.field = field;
        document.body.append(field);
      });
      const field = timer.locator("hub-folder-field");
      await expect(field).toContainText("Input folder");
      const browse = field.getByRole("button", {
        name: WORDS[language].browse,
        exact: true,
      });

      const titles = await stubOpenDialogs(hub, [
        { canceled: true, filePaths: [] },
        { canceled: false, filePaths: [dataDir] },
      ]);
      // Cancelling fires nothing: the one change is the chosen folder's.
      await browse.click();
      await expect.poll(titles).toEqual(["Input folder"]);
      await browse.click();
      await expect
        .poll(() => timer.evaluate(() => window.changes))
        .toEqual([{ kind: "chosen", path: dataDir }]);
      expect(await titles()).toEqual(["Input folder", "Input folder"]);
      expect(await timer.evaluate(() => window.field.value)).toEqual({
        kind: "chosen",
        path: dataDir,
      });
      await expect(field).toContainText(dataDir);
    } finally {
      await hub.close();
    }
  });
}

test("<hub-log> colours each tone from its token, keeps the newest line in view, and clears", async ({
  dataDir,
}) => {
  const { hub, timer } = await openTimerIn(dataDir, "en-HK");
  try {
    const colours = await timer.evaluate(() => {
      const log = document.createElement("hub-log");
      log.style.height = "80px";
      document.body.append(log);
      window.log = log;
      log.append({ tone: "info", text: "info line" });
      log.append({ tone: "success", text: "success line" });
      log.append({ tone: "danger", text: "danger line" });
      for (let line = 1; line <= 40; line += 1) {
        log.append({ tone: "info", text: `line ${String(line)}` });
      }
      // Each token's colour, resolved the same way the page resolves any colour.
      const token = (name: string): string => {
        const probe = document.createElement("span");
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        return getComputedStyle(probe).color;
      };
      return [
        token("--hub-color-fg"),
        token("--hub-color-success"),
        token("--hub-color-danger"),
      ];
    });
    const log = timer.locator("hub-log");
    const lineColours = await Promise.all(
      ["info line", "success line", "danger line"].map((text) =>
        log
          .getByText(text, { exact: true })
          .evaluate((line: object) => getComputedStyle(line).color),
      ),
    );
    expect(lineColours).toEqual(colours);
    expect(new Set(lineColours).size).toBe(3);

    await expect(log.getByText("line 40", { exact: true })).toBeInViewport();
    await expect(
      log.getByText("info line", { exact: true }),
    ).not.toBeInViewport();

    await timer.evaluate(() => {
      window.log.clear();
    });
    await expect(log.getByText("line 40", { exact: true })).toHaveCount(0);

    // One line fills the log exactly: no blank line from the template's whitespace above or below it.
    await timer.evaluate(() => {
      window.log.append({ tone: "info", text: "only line" });
    });
    const height = (element: object): number =>
      (element as Measured).getBoundingClientRect().height;
    expect(await log.getByRole("log").evaluate(height)).toBe(
      await log.getByText("only line", { exact: true }).evaluate(height),
    );
  } finally {
    await hub.close();
  }
});
