import { join, resolve } from "node:path";
import { PluginId } from "@hawkeye-hub/plugin-format";
import { expect, test } from "vitest";
import { uiFileFor } from "./plugin-scheme";

const TIMER = PluginId.parse("class-timer");

const UI = resolve("/plugins/class-timer@1.0.0/ui");

test("a URL on the Plugin's own host maps into its ui folder", () => {
  expect(uiFileFor(UI, TIMER, "hawkeye-plugin://class-timer/index.html")).toBe(
    join(UI, "index.html"),
  );
  expect(
    uiFileFor(UI, TIMER, "hawkeye-plugin://class-timer/assets/a%20b.js?v=1#x"),
  ).toBe(join(UI, "assets", "a b.js"));
});

test("another Plugin's host, or a path out of the ui folder, is refused", () => {
  expect(
    uiFileFor(UI, TIMER, "hawkeye-plugin://attendance/index.html"),
  ).toBeNull();
  // The URL parser collapses an encoded `..` segment, so this one never leaves the ui folder.
  expect(
    uiFileFor(UI, TIMER, "hawkeye-plugin://class-timer/%2e%2e/manifest.json"),
  ).toBe(join(UI, "manifest.json"));
  expect(
    uiFileFor(UI, TIMER, "hawkeye-plugin://class-timer/%2e%2e%2fmanifest.json"),
  ).toBeNull();
  expect(
    uiFileFor(UI, TIMER, "hawkeye-plugin://class-timer/..%5Cmanifest.json"),
  ).toBeNull();
  expect(
    uiFileFor(UI, TIMER, "hawkeye-plugin://class-timer/..%2Fui-other/x.js"),
  ).toBeNull();
  expect(uiFileFor(UI, TIMER, "hawkeye-plugin://class-timer/")).toBeNull();
});
