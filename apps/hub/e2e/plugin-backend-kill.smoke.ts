// Backends that do not stop (#52): after `shutdown` and the grace period the Hub kills the
// Backend's whole process tree, the Plugin is closing until then, and quitting waits for every
// Backend. The fixture Backend ignores `shutdown` and has a child process.

import type { ElectronApplication, Page } from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  hubLogLines,
  installFixturePlugins,
  isRunning,
  launchHub,
  lifecycleLine,
  overlayShowing,
  pluginLogMessages,
  pluginPage,
  test,
} from "./hub";

// The page's global, for code evaluated in a Plugin UI.
declare const window: {
  hub: {
    backend: { request(method: string, params: unknown): Promise<unknown> };
  };
};

// Longer than the Hub's 5 s grace period, with room for a slow CI runner.
const KILLED_WITHIN_MS = 20_000;

// Each test waits out the grace period on top of starting the Hub.
test.slow();

/** Opens the fixture Plugin by its plain English name, which is the same in every Display Language. */
async function openPlugin(
  hub: ElectronApplication,
  name: string,
  id: string,
): Promise<Page> {
  const hubChrome = await hub.firstWindow();
  await displayLanguageOf(hubChrome);
  await hubChrome.getByRole("button", { name, exact: true }).click();
  return pluginPage(() => hub.windows(), id);
}

function report<T>(page: Page): Promise<T> {
  return page.evaluate(
    () => window.hub.backend.request("report", {}) as Promise<T>,
  );
}

interface StubbornReport {
  pid: number;
  childPid: number;
}

function errorLines(dataDir: string): unknown[] {
  return hubLogLines(dataDir).filter(
    (line) =>
      typeof line === "object" &&
      line !== null &&
      "level" in line &&
      line.level === "error",
  );
}

test("a Backend that ignores shutdown is killed with its child after the grace period; the Plugin is closing until then, cannot be reopened, and then reopens", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("stubborn-backend")]);
  const hub = await launchHub(dataDir);
  try {
    const stubborn = await openPlugin(hub, "Stubborn", "stubborn-backend");
    const { pid, childPid } = await report<StubbornReport>(stubborn);
    const hubChrome = await hub.firstWindow();
    const item = hubChrome
      .getByRole("listitem")
      .filter({ hasText: "Stubborn" });
    const name = hubChrome.getByRole("button", {
      name: "Stubborn",
      exact: true,
    });

    await hubChrome
      .getByRole("button", { name: /^(Close Stubborn|關閉 Stubborn)$/ })
      .click();

    await expect(item).toContainText(/Closing|正在關閉/);
    await expect(name).toBeDisabled();
    await name.click({ force: true });
    await expect
      .poll(() => pluginLogMessages(dataDir, "stubborn-backend"))
      .toContain("ignoring shutdown");
    // Still inside the grace period: the Backend ignored shutdown and has not been killed yet.
    expect(isRunning(pid)).toBe(true);
    await expect(item).toContainText(/Closing|正在關閉/);

    await expect
      .poll(() => [isRunning(pid), isRunning(childPid)], {
        timeout: KILLED_WITHIN_MS,
      })
      .toEqual([false, false]);
    await expect(item).not.toContainText(/Closing|正在關閉/);
    // A kill after shutdown is a normal exit: no crash record, and no crash message.
    expect(errorLines(dataDir)).toEqual([]);
    expect(overlayShowing(hub)).toBe(false);

    await name.click();
    await pluginPage(() => hub.windows(), "stubborn-backend");
  } finally {
    await hub.close();
  }
});

test("a Backend that exits on shutdown by itself still has the child it left behind killed", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("leaving-backend")]);
  const hub = await launchHub(dataDir);
  try {
    const leaving = await openPlugin(hub, "Leaving", "leaving-backend");
    const { pid, childPid } = await report<StubbornReport>(leaving);
    const hubChrome = await hub.firstWindow();

    await hubChrome
      .getByRole("button", { name: /^(Close Leaving|關閉 Leaving)$/ })
      .click();

    await expect
      .poll(() => [isRunning(pid), isRunning(childPid)], {
        timeout: KILLED_WITHIN_MS,
      })
      .toEqual([false, false]);
    expect(errorLines(dataDir)).toEqual([]);
  } finally {
    await hub.close();
  }
});

test("quitting with two Backend Plugins open leaves neither Backend running and logs Hub closing once", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [
    fixtureInstall("echo-backend"),
    fixtureInstall("stubborn-backend"),
  ]);
  const hub = await launchHub(dataDir);
  const echo = await openPlugin(hub, "Echo", "echo-backend");
  const echoPid = (await report<{ pid: number }>(echo)).pid;
  const stubborn = await openPlugin(hub, "Stubborn", "stubborn-backend");
  const { pid, childPid } = await report<StubbornReport>(stubborn);

  await hub.close();

  expect([isRunning(echoPid), isRunning(pid), isRunning(childPid)]).toEqual([
    false,
    false,
    false,
  ]);
  expect(
    hubLogLines(dataDir).filter(
      (line) =>
        typeof line === "object" &&
        line !== null &&
        "message" in line &&
        line.message === "Hub closing",
    ),
  ).toEqual([lifecycleLine("Hub closing")]);
});
