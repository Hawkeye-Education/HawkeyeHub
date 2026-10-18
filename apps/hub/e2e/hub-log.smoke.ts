import { expect, hubLogLines, lifecycleLine, test } from "./hub";

test("starting and quitting the Hub logs Hub opened then Hub closing", async ({
  hub,
  dataDir,
}) => {
  await hub.firstWindow();

  await hub.close();

  expect(hubLogLines(dataDir)).toEqual([
    lifecycleLine("Hub opened"),
    lifecycleLine("Hub closing"),
  ]);
});
