// The Plugin Catalogue (#92): opened from the Plugin Switcher, it lists what the Registry at
// HAWKEYE_HUB_REGISTRY_URL offers. An unreachable Registry says so, with Retry, and logs it once.
// Dev mode has no Catalogue and checks no Registry.

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { _electron, type ElectronApplication } from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  FIXTURE_PLUGINS,
  HUB_DIR,
  hubEnv,
  hubLogLines,
  installFixturePlugins,
  switcherNames,
  test,
} from "./hub";

const STRINGS = {
  "en-HK": {
    catalogue: "Plugin Catalogue",
    unreachable: "Can't reach the Registry",
    retry: "Retry",
    names: ["Library", "Timer"],
    library: "Library",
    timer: "Timer",
    needsDifferentHub: "Needs a different Hub",
  },
  "zh-HK": {
    catalogue: "外掛程式目錄",
    unreachable: "無法連線至外掛程式庫",
    retry: "重試",
    // ICU zh-HK collation: Han by stroke count (計 9, 圖 14).
    names: ["計時器", "圖書館"],
    library: "圖書館",
    timer: "計時器",
    needsDifferentHub: "需要另一版本的 Hawkeye Hub",
  },
};

interface Registry {
  url: string;
  /** Every path asked for, in order. */
  requests: string[];
  server: Server;
}

/** A local Registry offering the class-timer and future-hub-api fixtures, with their icons. */
async function serveRegistry(): Promise<Registry> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    requests.push(path);
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${String(port)}`;
    if (path === "/index.json") {
      const offer = (id: string) => [
        {
          manifest: JSON.parse(
            readFileSync(join(FIXTURE_PLUGINS, id, "manifest.json"), "utf8"),
          ) as unknown,
          url: `${base}/${id}.zip`,
          sha256: "0".repeat(64),
          iconUrl: `${base}/${id}.svg`,
        },
      ];
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          plugins: {
            "class-timer": offer("class-timer"),
            "future-hub-api": offer("future-hub-api"),
          },
        }),
      );
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
  return {
    url: `http://127.0.0.1:${String(port)}/index.json`,
    requests,
    server,
  };
}

/** A URL on a local port nothing listens on: connecting is refused at once. */
async function unreachableUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${String(port)}/index.json`;
}

function launchWithRegistry(
  dataDir: string,
  registryUrl: string,
  args: string[] = [],
): Promise<ElectronApplication> {
  return _electron.launch({
    args: [HUB_DIR, ...args],
    env: { ...hubEnv(dataDir), HAWKEYE_HUB_REGISTRY_URL: registryUrl },
  });
}

function registryFailedLines(dataDir: string): unknown[] {
  return hubLogLines(dataDir).filter(
    (line) =>
      (line as { message: string }).message ===
      "Registry check failed: gave no response",
  );
}

test("the Catalogue opens from the Plugin Switcher and lists the Registry's Plugins with their icons and blocked reasons", async ({
  dataDir,
}) => {
  const registry = await serveRegistry();
  const hub = await launchWithRegistry(dataDir, registry.url);
  try {
    const hubChrome = await hub.firstWindow();
    const strings = STRINGS[await displayLanguageOf(hubChrome)];

    await hubChrome.getByRole("button", { name: strings.catalogue }).click();

    const catalogue = hubChrome.locator("plugin-catalogue");
    await expect(catalogue.getByRole("heading", { level: 3 })).toHaveText(
      strings.names,
    );
    const entry = (name: string) =>
      catalogue.getByRole("listitem").filter({ hasText: name });
    await expect(entry(strings.library)).toContainText(
      strings.needsDifferentHub,
    );
    await expect(entry(strings.timer)).toContainText(
      "A smoke-test fixture Plugin.",
    );
    await expect(entry(strings.timer)).not.toContainText(
      strings.needsDifferentHub,
    );
    // The icons come from the Registry, through main.
    await expect
      .poll(() => registry.requests)
      .toEqual(
        expect.arrayContaining(["/class-timer.svg", "/future-hub-api.svg"]),
      );
  } finally {
    await hub.close();
    registry.server.close();
  }
});

test("offline, the Catalogue says it can't reach the Registry, with Retry, logs once, and installed Plugins are unaffected", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const hub = await launchWithRegistry(dataDir, await unreachableUrl());
  try {
    const hubChrome = await hub.firstWindow();
    const language = await displayLanguageOf(hubChrome);
    const strings = STRINGS[language];

    await hubChrome.getByRole("button", { name: strings.catalogue }).click();

    await expect(hubChrome.getByRole("alert")).toHaveText(strings.unreachable);
    await expect(
      hubChrome.getByRole("button", { name: strings.retry }),
    ).toBeVisible();
    expect(registryFailedLines(dataDir)).toEqual([
      {
        time: expect.any(String),
        source: "hub",
        level: "warn",
        message: "Registry check failed: gave no response",
        pluginId: null,
        pluginVersion: null,
      },
    ]);
    expect(await switcherNames(hubChrome)).toEqual([
      language === "zh-HK" ? "計時器" : "Timer",
    ]);

    await hubChrome.getByRole("button", { name: strings.retry }).click();
    await expect.poll(() => registryFailedLines(dataDir)).toHaveLength(2);
    await expect(hubChrome.getByRole("alert")).toHaveText(strings.unreachable);
  } finally {
    await hub.close();
  }
});

test("dev mode has no Catalogue button and checks no Registry", async ({
  dataDir,
}) => {
  const registry = await serveRegistry();
  const hub = await launchWithRegistry(dataDir, registry.url, [
    "--plugins-dir",
    FIXTURE_PLUGINS,
    "--plugin",
    "class-timer",
  ]);
  try {
    const hubChrome = await hub.firstWindow();
    const strings = STRINGS[await displayLanguageOf(hubChrome)];
    await expect(hubChrome.locator("plugin-switcher")).toBeVisible();

    await expect(
      hubChrome.getByRole("button", { name: strings.catalogue }),
    ).toHaveCount(0);
    // Only the Company Configuration, which dev mode signs in with (PLUGIN_STANDARD §9.4).
    await expect
      .poll(() => registry.requests)
      .toEqual(["/company-config.json"]);
  } finally {
    await hub.close();
    registry.server.close();
  }
});
