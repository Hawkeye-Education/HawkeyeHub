import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, PluginId } from "@hawkeye-hub/plugin-format";
import { beforeAll, expect, test } from "vitest";
import { parseAbsolutePath } from "./ids";
import { pluginIconUrl, servePluginIcons } from "./plugin-icons";

const CLASS_TIMER = PluginId.parse("class-timer");
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>';

let serve: (request: Request) => Promise<Response>;

beforeAll(() => {
  const dataDir = mkdtempSync(join(tmpdir(), "hub-icons-"));
  const folder = join(dataDir, "class-timer@1.0.0");
  mkdirSync(join(folder, "ui"), { recursive: true });
  writeFileSync(join(folder, "icon.svg"), ICON);
  writeFileSync(join(folder, "manifest.json"), "{}");
  writeFileSync(join(folder, "ui", "index.html"), "<p>UI</p>");
  writeFileSync(join(dataDir, "secret.txt"), "secret");
  const parsed = parseManifest({
    id: "class-timer",
    version: "1.0.0",
    hubApi: "^1.0.0",
    name: "Timer",
    description: "A fixture.",
    platforms: ["win32-x64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "none" },
    assistant: { kind: "none" },
  });
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  serve = servePluginIcons([
    { folder: parseAbsolutePath(folder), manifest: parsed.manifest },
  ]);
});

test("an installed Plugin's icon URL serves its icon.svg as SVG, readable cross-origin", async () => {
  const response = await serve(new Request(pluginIconUrl(CLASS_TIMER)));

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(await response.text()).toBe(ICON);
});

test.each([
  ["another file of the Plugin", "hawkeye-icon://class-timer/manifest.json"],
  ["the Plugin UI", "hawkeye-icon://class-timer/ui/index.html"],
  ["the icon under another path", "hawkeye-icon://class-timer/ui/../icon.svg/"],
  ["a path out of the folder", "hawkeye-icon://class-timer/../secret.txt"],
  [
    "an encoded path out of the folder",
    "hawkeye-icon://class-timer/%2e%2e/secret.txt",
  ],
  ["a Plugin that is not installed", "hawkeye-icon://attendance/icon.svg"],
  ["a query", "hawkeye-icon://class-timer/icon.svg?x=1"],
])("refuses %s", async (_what, url) => {
  const response = await serve(new Request(url));

  expect(response.status).toBe(404);
  expect(await response.text()).toBe("");
});

test("refuses anything but GET", async () => {
  const response = await serve(
    new Request(pluginIconUrl(CLASS_TIMER), { method: "POST", body: "x" }),
  );

  expect(response.status).toBe(404);
});
