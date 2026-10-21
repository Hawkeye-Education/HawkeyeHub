// Dev mode (#83, PLUGIN_STANDARD §9.4): `--plugin <id>` runs `<--plugins-dir>/<id>` as the Hub's
// only Plugin, without the record of installed Plugins.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { _electron } from "@playwright/test";
import {
  displayLanguageOf,
  electronBinary,
  expect,
  FIXTURE_PLUGINS,
  HUB_DIR,
  hubEnv,
  pluginPage,
  switcherNames,
  test,
} from "./hub";

// The fixture Plugin UI's page globals, for code evaluated in its page.
declare const window: {
  hub: {
    backend: { request(method: string, params: unknown): Promise<unknown> };
  };
};

test("dev mode opens the named Plugin from its folder and never touches the record", async ({
  dataDir,
}) => {
  const hub = await _electron.launch({
    args: [
      HUB_DIR,
      "--plugins-dir",
      FIXTURE_PLUGINS,
      "--plugin",
      "echo-backend",
    ],
    env: hubEnv(dataDir),
  });
  try {
    const hubChrome = await hub.firstWindow();
    await displayLanguageOf(hubChrome);
    expect(await switcherNames(hubChrome)).toEqual(["Echo"]);
    await hubChrome.getByRole("button", { name: "Echo", exact: true }).click();
    const echo = await pluginPage(() => hub.windows(), "echo-backend");
    // The Backend runs from the fixture's own backend folder.
    const { cwd } = (await echo.evaluate(() =>
      window.hub.backend.request("report", {}),
    )) as { cwd: string };
    expect(cwd).toBe(join(FIXTURE_PLUGINS, "echo-backend", "backend"));
    expect(existsSync(join(dataDir, "installed-plugins.json"))).toBe(false);
  } finally {
    await hub.close();
  }
});

test("dev mode with a Plugin that cannot be loaded exits non-zero with why", async ({
  dataDir,
}) => {
  const child = spawn(
    electronBinary,
    [HUB_DIR, "--plugins-dir", FIXTURE_PLUGINS, "--plugin", "invalid-manifest"],
    { env: hubEnv(dataDir), stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve) => {
    child.once("exit", resolve);
  });
  expect(code).toBe(1);
  expect(stderr).toContain('Plugin "invalid-manifest"');
  expect(stderr).toContain("manifest-invalid");
});
