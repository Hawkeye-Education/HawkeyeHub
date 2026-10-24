import { join } from "node:path";
import { expect, test } from "vitest";
import { parseHubMode } from "./hub-mode";
import { parseAbsolutePath } from "./ids";

const cwd = parseAbsolutePath(join(process.cwd(), "apps", "hub"));
// What Electron's argv starts with: its binary and the app's folder.
const electron = ["/electron", "."];

test("no --plugin is an installed Hub", () => {
  expect(parseHubMode([...electron], false, cwd)).toEqual({
    kind: "installed",
  });
  expect(
    parseHubMode([...electron, "--plugins-dir", "../../plugins"], false, cwd),
  ).toEqual({ kind: "installed" });
});

test("each --plugin names a folder of --plugins-dir, resolved against the working folder", () => {
  expect(
    parseHubMode(
      [
        ...electron,
        "--plugins-dir",
        "../../plugins",
        "--plugin",
        "seating-plan",
        "--remote-debugging-port=0",
        "--plugin",
        "class-timer",
      ],
      false,
      cwd,
    ),
  ).toEqual({
    kind: "dev",
    pluginsDir: join(cwd, "..", "..", "plugins"),
    ids: ["seating-plan", "class-timer"],
    companyConfiguration: { kind: "registry" },
  });
});

test("--company-config reads the Company Configuration from a file, resolved against the working folder", () => {
  expect(
    parseHubMode(
      [
        ...electron,
        "--plugins-dir",
        "/plugins",
        "--plugin",
        "seating-plan",
        "--company-config",
        "e2e/company-config.json",
      ],
      false,
      cwd,
    ),
  ).toMatchObject({
    kind: "dev",
    companyConfiguration: {
      kind: "file",
      path: join(cwd, "e2e", "company-config.json"),
    },
  });
});

test("a packaged Hub ignores --plugin and --company-config", () => {
  expect(
    parseHubMode(
      [
        ...electron,
        "--plugins-dir",
        "/plugins",
        "--plugin",
        "seating-plan",
        "--company-config",
        "company-config.json",
      ],
      true,
      cwd,
    ),
  ).toEqual({ kind: "installed" });
  expect(
    parseHubMode([...electron, "--company-config", "c.json"], true, cwd),
  ).toEqual({ kind: "installed" });
});

test("a malformed dev-mode command line throws with why", () => {
  expect(() =>
    parseHubMode([...electron, "--plugin", "seating-plan"], false, cwd),
  ).toThrow("--plugins-dir");
  expect(() =>
    parseHubMode(
      [...electron, "--plugins-dir", "/p", "--plugin", "Seating Plan"],
      false,
      cwd,
    ),
  ).toThrow('Not a Plugin id: "Seating Plan"');
  expect(() =>
    parseHubMode([...electron, "--plugins-dir", "/p", "--plugin"], false, cwd),
  ).toThrow("--plugin needs a Plugin id");
  expect(() =>
    parseHubMode([...electron, "--plugin", "a", "--plugins-dir"], false, cwd),
  ).toThrow("--plugins-dir");
  expect(() =>
    parseHubMode(
      [...electron, "--plugins-dir", "/p", "--plugin", "a", "--plugin", "a"],
      false,
      cwd,
    ),
  ).toThrow('--plugin "a" is named twice');
  expect(() =>
    parseHubMode(
      [...electron, "--plugins-dir", "/p", "--plugin", "a", "--company-config"],
      false,
      cwd,
    ),
  ).toThrow("--company-config needs a file");
  expect(() =>
    parseHubMode([...electron, "--company-config", "c.json"], false, cwd),
  ).toThrow("--company-config needs dev mode: --plugin <id>");
});
