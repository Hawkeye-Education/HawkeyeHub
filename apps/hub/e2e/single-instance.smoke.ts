import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { expect, HUB_DIR, hubLogLines, lifecycleLine, test } from "./hub";

// The electron package's runtime export is the binary's path, but its types describe the
// Electron API, so it is read as unknown and narrowed.
const electronBinary: unknown = createRequire(import.meta.url)("electron");

// Not through _electron.launch: it throws for a process that quits before ready, which would
// look the same as a Hub that failed to start.
function launchSecondHub(dataDir: string): Promise<number | null> {
  if (typeof electronBinary !== "string") {
    throw new Error("electron did not resolve to its binary path");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary, [HUB_DIR], {
      env: { ...process.env, HAWKEYE_HUB_DATA_DIR: dataDir },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
}

test("a second launch with the same data folder exits and leaves the first window open", async ({
  hub,
  dataDir,
}) => {
  const hubChrome = await hub.firstWindow();

  expect(await launchSecondHub(dataDir)).toBe(0);

  await expect(hubChrome.getByText("Hawkeye Hub")).toBeVisible();
  const windowCount = await hub.evaluate(
    ({ BaseWindow }) => BaseWindow.getAllWindows().length,
  );
  expect(windowCount).toBe(1);
});

test("a second launch logs nothing to hub.log", async ({ hub, dataDir }) => {
  await hub.firstWindow();

  await launchSecondHub(dataDir);
  await hub.close();

  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    lifecycleLine("Hub closing"),
  ]);
});
