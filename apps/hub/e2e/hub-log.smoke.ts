import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./hub";

function hubLogLines(dataDir: string): unknown[] {
  return readFileSync(join(dataDir, "logs", "hub.log"), "utf8")
    .trimEnd()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
}

function lifecycleLine(message: string): unknown {
  return {
    time: expect.any(String),
    source: "hub",
    level: "info",
    message,
    pluginId: null,
    pluginVersion: null,
  };
}

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
