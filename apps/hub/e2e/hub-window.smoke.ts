import { join } from "node:path";
import { expect, test } from "./hub";

test("the Hub shows one window whose Hub Chrome says Hawkeye Hub", async ({
  hub,
}) => {
  const hubChrome = await hub.firstWindow();

  await expect(hubChrome.getByText("Hawkeye Hub")).toBeVisible();
  const titles = await hub.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows().map((window) => window.getTitle()),
  );
  expect(titles).toEqual(["Hawkeye Hub"]);
});

test("the Hub Chrome has no Node access", async ({ hub }) => {
  const hubChrome = await hub.firstWindow();

  const nodeGlobals = await hubChrome.evaluate(() =>
    ["require", "process", "module", "Buffer"].filter(
      (name) => name in globalThis,
    ),
  );
  expect(nodeGlobals).toEqual([]);
});

test("closing the window quits the Hub", async ({ hub }) => {
  await hub.firstWindow();
  const exitCode = new Promise<number | null>((resolve) => {
    hub.process().once("exit", resolve);
  });

  await hub.evaluate(({ BaseWindow }) => {
    for (const window of BaseWindow.getAllWindows()) window.close();
  });

  expect(await exitCode).toBe(0);
});

test("the Hub keeps its user data and logs under HAWKEYE_HUB_DATA_DIR", async ({
  hub,
  dataDir,
}) => {
  const paths = await hub.evaluate(({ app }) => ({
    userData: app.getPath("userData"),
    logs: app.getPath("logs"),
  }));

  expect(paths).toEqual({
    userData: join(dataDir, "user-data"),
    logs: join(dataDir, "logs"),
  });
});
