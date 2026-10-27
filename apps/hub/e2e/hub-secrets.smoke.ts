// `hub.secrets` (#161): every Plugin UI keeps named secrets through main, encrypted with the real
// safeStorage. Each rule behind it is a Vitest test of `plugin-secrets.ts`; this proves the wiring.

import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  pluginPage,
  test,
} from "./hub";

declare const window: {
  hub: {
    secrets: {
      get(name: string): Promise<unknown>;
      set(name: string, value: string): Promise<void>;
      remove(name: string): Promise<void>;
    };
  };
};

test("a secret set from the page reads back, a bad name rejects with its HubError, and a removed one is missing", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("class-timer")]);
  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    const language = await displayLanguageOf(hubChrome);
    await hubChrome
      .getByRole("button", {
        name: language === "zh-HK" ? "計時器" : "Timer",
        exact: true,
      })
      .click();
    const timer = await pluginPage(() => hub.windows(), "class-timer");

    expect(
      await timer.evaluate(async () => {
        await window.hub.secrets.set("sheets-key", "pk-secret");
        return window.hub.secrets.get("sheets-key");
      }),
    ).toEqual({ kind: "stored", value: "pk-secret" });
    expect(
      await timer.evaluate(() =>
        window.hub.secrets.get("Sheets Key").catch((error: unknown) => error),
      ),
    ).toEqual({ code: "secret-name-invalid", name: "Sheets Key" });
    expect(
      await timer.evaluate(async () => {
        await window.hub.secrets.remove("sheets-key");
        return window.hub.secrets.get("sheets-key");
      }),
    ).toEqual({ kind: "missing" });
  } finally {
    await hub.close();
  }
});
