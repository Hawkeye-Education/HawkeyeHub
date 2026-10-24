import { PluginId } from "@hawkeye-hub/plugin-format";
import { expect, test } from "vitest";
import {
  grantsPermission,
  opensInSystemBrowser,
  staysInPlugin,
} from "./plugin-lockdown";

const CLASS_TIMER = PluginId.parse("class-timer");

test("a Plugin UI may navigate only within its own hawkeye-plugin origin", () => {
  expect(staysInPlugin(CLASS_TIMER, "hawkeye-plugin://class-timer/")).toBe(
    true,
  );
  expect(
    staysInPlugin(CLASS_TIMER, "hawkeye-plugin://class-timer/b.html?x#y"),
  ).toBe(true);
  for (const url of [
    "hawkeye-plugin://attendance/index.html",
    "hawkeye-icon://class-timer/icon.svg",
    "https://example.com/",
    "http://class-timer/",
    "file:///C:/Windows/win.ini",
    "javascript:alert(1)",
    "about:blank",
    "not a url",
  ])
    expect(staysInPlugin(CLASS_TIMER, url), url).toBe(false);
});

test("only an https link opens in the system browser", () => {
  expect(opensInSystemBrowser("https://example.com/a?b")).toBe(true);
  for (const url of [
    "http://example.com/",
    "file:///C:/Windows/win.ini",
    "javascript:alert(1)",
    "mailto:a@b.c",
    "hawkeye-plugin://class-timer/index.html",
    "not a url",
  ])
    expect(opensInSystemBrowser(url), url).toBe(false);
});

test("only the clipboard is granted, and only to the Plugin's own page", () => {
  const own = "hawkeye-plugin://class-timer/";
  expect(grantsPermission(CLASS_TIMER, "clipboard-sanitized-write", own)).toBe(
    true,
  );
  expect(grantsPermission(CLASS_TIMER, "clipboard-read", own)).toBe(true);
  expect(
    grantsPermission(
      CLASS_TIMER,
      "clipboard-read",
      "hawkeye-plugin://attendance/",
    ),
  ).toBe(false);
  for (const permission of [
    "media",
    "notifications",
    "geolocation",
    "deprecated-sync-clipboard-read",
    "fullscreen",
    "openExternal",
    "unknown",
  ])
    expect(grantsPermission(CLASS_TIMER, permission, own), permission).toBe(
      false,
    );
});
