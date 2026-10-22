// Install from the Plugin Catalogue (#93): a local Registry at HAWKEYE_HUB_REGISTRY_URL serves a
// UI-only Plugin Package; Install puts it in the Plugin Switcher without a restart, and it opens. A
// package that fails its checksum says why and leaves nothing behind. Leftovers are swept at launch.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, sep } from "node:path";
import { _electron, type ElectronApplication } from "@playwright/test";
import { zipSync } from "fflate";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  FIXTURE_PLUGINS,
  HUB_DIR,
  hubEnv,
  hubLogLines,
  installFixturePlugins,
  pluginPage,
  switcherNames,
  test,
} from "./hub";

const STRINGS = {
  "en-HK": {
    catalogue: "Plugin Catalogue",
    install: "Install",
    timer: "Timer",
    attendance: "Attendance",
    installed: "Installed: version 1.0.0",
    checksumFailed: "Install failed: the download was damaged",
    exportDiagnostics: "Export diagnostics",
  },
  "zh-HK": {
    catalogue: "外掛程式目錄",
    install: "安裝",
    timer: "計時器",
    attendance: "點名",
    installed: "已安裝：版本 1.0.0",
    checksumFailed: "安裝失敗：下載的檔案已損壞",
    exportDiagnostics: "匯出診斷資料",
  },
};

/** A fixture Plugin's folder as a Plugin Package: a zip with "/" paths. */
function packageOf(fixture: string): Uint8Array {
  const root = join(FIXTURE_PLUGINS, fixture);
  const files: Record<string, Uint8Array> = {};
  for (const path of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (statSync(join(root, path)).isFile()) {
      files[path.split(sep).join("/")] = readFileSync(join(root, path));
    }
  }
  return zipSync(files);
}

/**
 * A local Registry offering class-timer, whose package matches its checksum, and attendance,
 * whose package does not.
 */
async function serveRegistry(): Promise<{ url: string; server: Server }> {
  const packages = {
    "class-timer": packageOf("class-timer"),
    attendance: packageOf("attendance"),
  };
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${String(port)}`;
    if (path === "/index.json") {
      const offer = (id: keyof typeof packages, sha256: string) => [
        {
          manifest: JSON.parse(
            readFileSync(join(FIXTURE_PLUGINS, id, "manifest.json"), "utf8"),
          ) as unknown,
          url: `${base}/${id}.zip`,
          sha256,
          iconUrl: `${base}/${id}.svg`,
        },
      ];
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          plugins: {
            "class-timer": offer(
              "class-timer",
              createHash("sha256")
                .update(packages["class-timer"])
                .digest("hex"),
            ),
            attendance: offer("attendance", "0".repeat(64)),
          },
        }),
      );
      return;
    }
    const zip = /^\/([a-z-]+)\.zip$/.exec(path)?.[1];
    if (zip === "class-timer" || zip === "attendance") {
      response.end(packages[zip]);
      return;
    }
    const icon = /^\/([a-z-]+)\.svg$/.exec(path)?.[1];
    if (icon !== undefined) {
      response.end(readFileSync(join(FIXTURE_PLUGINS, icon, "icon.svg")));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}/index.json`, server };
}

function launchWithRegistry(
  dataDir: string,
  registryUrl: string,
): Promise<ElectronApplication> {
  return _electron.launch({
    args: [HUB_DIR],
    env: { ...hubEnv(dataDir), HAWKEYE_HUB_REGISTRY_URL: registryUrl },
  });
}

function hubLogMessages(dataDir: string): string[] {
  return hubLogLines(dataDir).map(
    (line) => (line as { message: string }).message,
  );
}

test("Install puts a UI-only Plugin in the Plugin Switcher without a restart, and it opens", async ({
  dataDir,
}) => {
  const registry = await serveRegistry();
  const hub = await launchWithRegistry(dataDir, registry.url);
  try {
    const hubChrome = await hub.firstWindow();
    const strings = STRINGS[await displayLanguageOf(hubChrome)];
    expect(await switcherNames(hubChrome)).toEqual([]);

    await hubChrome.getByRole("button", { name: strings.catalogue }).click();
    const timer = hubChrome
      .locator("plugin-catalogue")
      .getByRole("listitem")
      .filter({ hasText: strings.timer });
    await timer.getByRole("button", { name: strings.install }).click();

    await expect(timer).toContainText(strings.installed);
    await expect(timer.getByRole("button")).toHaveCount(0);
    await expect.poll(() => switcherNames(hubChrome)).toEqual([strings.timer]);
    expect(
      JSON.parse(
        readFileSync(join(dataDir, "installed-plugins.json"), "utf8"),
      ) as unknown,
    ).toEqual([{ id: "class-timer", version: "1.0.0" }]);

    await hubChrome
      .getByRole("navigation")
      .getByRole("button", { name: strings.timer, exact: true })
      .click();
    const page = await pluginPage(() => hub.windows(), "class-timer");
    await expect(page.locator("body")).toContainText("Fixture Plugin UI");
  } finally {
    await hub.close();
    registry.server.close();
  }
});

test("a package that fails its checksum shows why with Export diagnostics, logs it and leaves nothing on disk", async ({
  dataDir,
}) => {
  const registry = await serveRegistry();
  const hub = await launchWithRegistry(dataDir, registry.url);
  try {
    const hubChrome = await hub.firstWindow();
    const strings = STRINGS[await displayLanguageOf(hubChrome)];

    await hubChrome.getByRole("button", { name: strings.catalogue }).click();
    const attendance = hubChrome
      .locator("plugin-catalogue")
      .getByRole("listitem")
      .filter({ hasText: strings.attendance });
    await attendance.getByRole("button", { name: strings.install }).click();

    await expect(attendance.getByRole("alert")).toHaveText(
      strings.checksumFailed,
    );
    await expect(
      attendance.getByRole("button", { name: strings.exportDiagnostics }),
    ).toBeVisible();
    // Install can be tried again.
    await expect(
      attendance.getByRole("button", { name: strings.install }),
    ).toBeVisible();
    expect(hubLogMessages(dataDir)).toContain(
      "Plugin install failed: checksum",
    );
    expect(existsSync(join(dataDir, "attendance@1.0.0"))).toBe(false);
    expect(existsSync(join(dataDir, "attendance@1.0.0.partial"))).toBe(false);
    expect(await switcherNames(hubChrome)).toEqual([]);
  } finally {
    await hub.close();
    registry.server.close();
  }
});

test("at launch the Hub sweeps .partial folders and versions the record does not name, logging each", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  mkdirSync(join(dataDir, "attendance@1.0.0.partial"));
  mkdirSync(join(dataDir, "class-timer@0.9.0"));
  const registry = await serveRegistry();
  const hub = await launchWithRegistry(dataDir, registry.url);
  try {
    const hubChrome = await hub.firstWindow();
    const strings = STRINGS[await displayLanguageOf(hubChrome)];

    expect(await switcherNames(hubChrome)).toEqual([strings.timer]);
    expect(readdirSync(dataDir).filter((name) => name.includes("@"))).toEqual([
      "class-timer@1.0.0",
    ]);
    expect(
      hubLogMessages(dataDir)
        .filter((message) => message.startsWith("Plugin folder swept"))
        .sort(),
    ).toEqual([
      "Plugin folder swept: not in the record",
      "Plugin folder swept: partial",
    ]);
  } finally {
    await hub.close();
    registry.server.close();
  }
});
