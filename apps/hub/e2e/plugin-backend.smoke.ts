// A Plugin's Backend: started at open with `initialize`, reached through `window.hub.backend`, and
// sent `shutdown` at close (#51). The fixture Backend is standard-library Python speaking raw
// JSON-RPC, in the venv global setup made.

import { join } from "node:path";
import {
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  HUB_DIR,
  hubEnv,
  hubLogLines,
  installFixturePlugins,
  launchHub,
  pluginLogMessages,
  pluginPage,
  test,
} from "./hub";

// The fixture Plugin UI's and the page's globals, for code evaluated in its page.
declare const window: {
  observed: { pongs: unknown[]; answer: unknown; error: unknown };
  hub: {
    backend: { request(method: string, params: unknown): Promise<unknown> };
  };
};

interface Started {
  initialize: {
    dataDir: string;
    stores: Record<string, string>;
    hubApi: string;
  };
  dataDirExists: boolean;
  storesExist: Record<string, boolean>;
  cwd: string;
  localeVariables: string[];
  pid: number;
}

/** A Hub with the echo-backend fixture open, started with locale variables a Backend must not get. */
async function openEchoBackend(
  dataDir: string,
): Promise<{ hub: ElectronApplication; echo: Page }> {
  installFixturePlugins(dataDir, [fixtureInstall("echo-backend")]);
  const hub = await _electron.launch({
    args: [HUB_DIR],
    env: { ...hubEnv(dataDir), LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
  });
  const hubChrome = await hub.firstWindow();
  await displayLanguageOf(hubChrome);
  // The fixture's name is plain English, the same in every Display Language.
  await hubChrome.getByRole("button", { name: "Echo", exact: true }).click();
  return { hub, echo: await pluginPage(() => hub.windows(), "echo-backend") };
}

function started(echo: Page): Promise<Started> {
  return echo.evaluate(
    () => window.hub.backend.request("report", {}) as Promise<Started>,
  );
}

test("the Backend starts in its backend folder, without LANG or LC_*, and gets initialize with its existing data folder and stores", async ({
  dataDir,
}) => {
  const { hub, echo } = await openEchoBackend(dataDir);
  try {
    expect(await started(echo)).toEqual({
      initialize: {
        dataDir: join(dataDir, "plugin-data", "echo-backend"),
        stores: {
          "class-lists": join(dataDir, "stores", "class-lists"),
          seating: join(dataDir, "stores", "seating"),
        },
        hubApi: "1.0.0",
      },
      dataDirExists: true,
      storesExist: { "class-lists": true, seating: true },
      cwd: join(dataDir, "echo-backend@1.0.0", "backend"),
      localeVariables: [],
      pid: expect.any(Number),
    });
  } finally {
    await hub.close();
  }
});

test("requests sent at page load are answered, a JSON-RPC error rejects with backend-error, and Backend notifications reach onNotification", async ({
  dataDir,
}) => {
  const { hub, echo } = await openEchoBackend(dataDir);
  try {
    await expect
      .poll(() => echo.evaluate(() => window.observed))
      .toEqual({
        pongs: [{ n: 1 }],
        answer: { n: 1 },
        error: {
          code: "backend-error",
          rpc: {
            code: -32000,
            message: "Asked to fail",
            data: { reason: "asked-to-fail" },
          },
        },
      });
    expect(pluginLogMessages(dataDir, "echo-backend")).toContain(
      "fail failed: asked-to-fail: Asked to fail",
    );
  } finally {
    await hub.close();
  }
});

function isRunning(pid: number): boolean {
  try {
    // Signal 0 only checks that the process exists.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function backendLine(message: string): unknown {
  return {
    time: expect.any(String),
    source: "hub",
    level: "info",
    message,
    pluginId: "echo-backend",
    pluginVersion: "1.0.0",
  };
}

test("closing the Plugin sends its Backend shutdown, and it exits and is gone; the spawn and exit are logged", async ({
  dataDir,
}) => {
  const { hub, echo } = await openEchoBackend(dataDir);
  try {
    const { pid } = await started(echo);
    const hubChrome = await hub.firstWindow();

    await hubChrome
      .getByRole("button", { name: /^(Close Echo|關閉 Echo)$/ })
      .click();

    await expect
      .poll(() => pluginLogMessages(dataDir, "echo-backend"))
      .toContain("got shutdown");
    await expect.poll(() => isRunning(pid)).toBe(false);
    await expect
      .poll(() =>
        hubLogLines(dataDir).filter(
          (line) =>
            typeof line === "object" &&
            line !== null &&
            "pluginId" in line &&
            line.pluginId === "echo-backend",
        ),
      )
      .toEqual([
        backendLine("Backend spawned"),
        backendLine("Backend exited with code 0"),
      ]);
  } finally {
    await hub.close();
  }
});

test("a UI-only Plugin has no hub.backend", async ({ dataDir }) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    const timerName =
      (await displayLanguageOf(hubChrome)) === "zh-HK" ? "計時器" : "Timer";
    await hubChrome
      .getByRole("button", { name: timerName, exact: true })
      .click();
    const timer = await pluginPage(() => hub.windows(), "class-timer");

    expect(await timer.evaluate(() => "backend" in window.hub)).toBe(false);
  } finally {
    await hub.close();
  }
});
