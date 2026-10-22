// `hub.stores` (#97): a Plugin UI lists, reads, writes and watches the Shared Stores its Manifest
// declares, in the same folders its Backend gets. The echo-backend fixture declares `class-lists`
// and `seating`; the smoke test writes into a store's folder itself, as a Backend would.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron } from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  HUB_DIR,
  hubEnv,
  installFixturePlugins,
  pluginPage,
  test,
} from "./hub";

interface StoreChange {
  path: string;
  kind: "changed" | "removed";
}

// The page's globals, for code evaluated in it.
declare const window: {
  hub: {
    stores: {
      list(store: string): Promise<string[]>;
      readText(store: string, path: string): Promise<string>;
      readBytes(store: string, path: string): Promise<Uint8Array>;
      writeText(store: string, path: string, text: string): Promise<void>;
      writeBytes(store: string, path: string, bytes: Uint8Array): Promise<void>;
      watch(
        store: string,
        handler: (change: StoreChange) => void,
      ): Promise<() => void>;
    };
  };
  changes: StoreChange[];
  stopWatch: () => void;
};

test("a Plugin UI writes, lists and reads a declared store its Backend shares, watches it, and is refused what it got wrong", async ({
  dataDir,
}) => {
  installFixturePlugins(dataDir, [fixtureInstall("echo-backend")]);
  const hub = await _electron.launch({ args: [HUB_DIR], env: hubEnv(dataDir) });
  try {
    const hubChrome = await hub.firstWindow();
    await displayLanguageOf(hubChrome);
    await hubChrome.getByRole("button", { name: "Echo", exact: true }).click();
    const echo = await pluginPage(() => hub.windows(), "echo-backend");
    // The folder the Backend gets for `seating` in `initialize`.
    const seating = join(dataDir, "stores", "seating");

    await echo.evaluate(async () => {
      window.changes = [];
      window.stopWatch = await window.hub.stores.watch("seating", (change) => {
        window.changes.push(change);
      });
      await window.hub.stores.writeText("seating", "rooms/4a.json", "[1]");
      await window.hub.stores.writeBytes(
        "seating",
        "plan.bin",
        new Uint8Array([0, 255]),
      );
    });
    expect(readFileSync(join(seating, "rooms", "4a.json"), "utf8")).toBe("[1]");
    writeFileSync(join(seating, "backend.json"), "[2]");

    expect(
      await echo.evaluate(async () => ({
        list: [...(await window.hub.stores.list("seating"))].sort(),
        text: await window.hub.stores.readText("seating", "backend.json"),
        bytes: [...(await window.hub.stores.readBytes("seating", "plan.bin"))],
      })),
    ).toEqual({
      list: ["backend.json", "plan.bin", "rooms/4a.json"],
      text: "[2]",
      bytes: [0, 255],
    });
    await expect
      .poll(() => echo.evaluate(() => window.changes))
      .toEqual(
        expect.arrayContaining([
          { path: "rooms/4a.json", kind: "changed" },
          { path: "backend.json", kind: "changed" },
        ]),
      );

    expect(
      await echo.evaluate(async () => {
        const refusal = async (call: () => Promise<unknown>) =>
          call().then(
            () => "resolved",
            (error: unknown) => error,
          );
        return {
          watchRefusal: await refusal(() =>
            window.hub.stores.watch("receipts", () => undefined),
          ),
          undeclared: await refusal(() =>
            window.hub.stores.readText("receipts", "a.json"),
          ),
          parent: await refusal(() =>
            window.hub.stores.writeText("seating", "../kb/a.md", "x"),
          ),
          missing: await refusal(() =>
            window.hub.stores.readText("seating", "missing.json"),
          ),
        };
      }),
    ).toEqual({
      undeclared: { code: "store-not-declared", store: "receipts" },
      parent: { code: "bad-path", path: "../kb/a.md" },
      missing: { code: "not-found", store: "seating", path: "missing.json" },
      watchRefusal: { code: "store-not-declared", store: "receipts" },
    });

    const seen = await echo.evaluate(() => {
      window.stopWatch();
      return window.changes.length;
    });
    writeFileSync(join(seating, "after-stop.json"), "[3]");
    // Long enough for a watch that had not stopped to report it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await echo.evaluate(() => window.changes.length)).toBe(seen);
  } finally {
    await hub.close();
  }
});
