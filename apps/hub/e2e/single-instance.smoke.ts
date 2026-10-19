import { spawn } from "node:child_process";
import {
  electronBinary,
  expect,
  HUB_DIR,
  hubEnv,
  hubLogLines,
  lifecycleLine,
  test,
} from "./hub";

// Not through _electron.launch: it throws for a process that quits before ready, which would
// look the same as a Hub that failed to start.
function launchSecondHub(dataDir: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary, [HUB_DIR], {
      env: hubEnv(dataDir),
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

test("a second launch restores the minimised window", async ({
  hub,
  dataDir,
}) => {
  await hub.firstWindow();
  const minimised = () =>
    hub.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().map((window) => window.isMinimized()),
    );
  await hub.evaluate(({ BaseWindow }) => {
    for (const window of BaseWindow.getAllWindows()) window.minimize();
  });
  await expect.poll(minimised).toEqual([true]);

  await launchSecondHub(dataDir);

  await expect.poll(minimised).toEqual([false]);
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
