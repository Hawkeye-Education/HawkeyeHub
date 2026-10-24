// `hub.files` (#120): every Plugin UI picks a folder with the Hub's folder dialog, modal to the Hub
// window, and reveals one with the OS shell. The dialog and the shell are stubbed in main.

import type { ElectronApplication } from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  pluginPage,
  test,
} from "./hub";

type PickFolderResult =
  { kind: "chosen"; path: string } | { kind: "cancelled" };

declare const window: {
  hub: {
    files: {
      pickFolder(title: string): Promise<PickFolderResult>;
      openFolder(path: string): Promise<void>;
    };
  };
};

interface Shown {
  modal: boolean;
  title: string;
  properties: string[];
}

/** Answers every folder dialog with `answer`, and returns what each one was shown with. */
async function stubOpenDialog(
  hub: ElectronApplication,
  answer: { canceled: boolean; filePaths: string[] },
): Promise<() => Promise<Shown[]>> {
  await hub.evaluate(({ dialog }, answer) => {
    const shown: Shown[] = [];
    (globalThis as unknown as { openDialogsShown: Shown[] }).openDialogsShown =
      shown;
    dialog.showOpenDialog = (...args: unknown[]) => {
      // Called as (options) or (window, options).
      const options = args.at(-1) as { title: string; properties: string[] };
      shown.push({
        modal: args.length === 2,
        title: options.title,
        properties: options.properties,
      });
      return Promise.resolve({ ...answer, bookmarks: [] });
    };
  }, answer);
  return () =>
    hub.evaluate(
      () =>
        (globalThis as unknown as { openDialogsShown: Shown[] })
          .openDialogsShown,
    );
}

async function openTimer(dataDir: string) {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const hub = await launchHub(dataDir);
  const hubChrome = await hub.firstWindow();
  const language = await displayLanguageOf(hubChrome);
  await hubChrome
    .getByRole("button", {
      name: language === "zh-HK" ? "計時器" : "Timer",
      exact: true,
    })
    .click();
  return { hub, timer: await pluginPage(() => hub.windows(), "class-timer") };
}

test("pickFolder answers chosen with the dialog's folder, modal to the Hub window, and cancelled when the dialog is cancelled", async ({
  dataDir,
}) => {
  const { hub, timer } = await openTimer(dataDir);
  try {
    const shown = await stubOpenDialog(hub, {
      canceled: false,
      filePaths: [dataDir],
    });
    expect(
      await timer.evaluate(() => window.hub.files.pickFolder("Input folder")),
    ).toEqual({ kind: "chosen", path: dataDir });
    expect(await shown()).toEqual([
      { modal: true, title: "Input folder", properties: ["openDirectory"] },
    ]);

    await stubOpenDialog(hub, { canceled: true, filePaths: [] });
    expect(
      await timer.evaluate(() => window.hub.files.pickFolder("Input folder")),
    ).toEqual({ kind: "cancelled" });
  } finally {
    await hub.close();
  }
});

test("openFolder reveals the folder with shell.openPath", async ({
  dataDir,
}) => {
  const { hub, timer } = await openTimer(dataDir);
  try {
    await hub.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { opened: string[] }).opened = opened;
      shell.openPath = (path: string) => {
        opened.push(path);
        return Promise.resolve("");
      };
    });

    await timer.evaluate(
      (folder) => window.hub.files.openFolder(folder),
      dataDir,
    );

    expect(
      await hub.evaluate(
        () => (globalThis as unknown as { opened: string[] }).opened,
      ),
    ).toEqual([dataDir]);
  } finally {
    await hub.close();
  }
});
