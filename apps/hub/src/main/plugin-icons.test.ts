import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, PluginId } from "@hawkeye-hub/plugin-format";
import { beforeAll, expect, test } from "vitest";
import { parseAbsolutePath } from "./ids";
import type { InstalledPlugin } from "./installed-plugins";
import {
  pluginIconUrl,
  registryIconUrl,
  servePluginIcons,
} from "./plugin-icons";

const CLASS_TIMER = PluginId.parse("class-timer");
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>';

let serve: (request: Request) => Promise<Response>;
// The installed Plugins: the handler reads them on every request, so an install shows at once.
let installedPlugins: InstalledPlugin[];

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
  installedPlugins = [
    { folder: parseAbsolutePath(folder), manifest: parsed.manifest },
  ];
  serve = servePluginIcons(
    () => installedPlugins,
    () => registryIcons,
    (url) =>
      Promise.resolve(
        url === REMOTE_ICON
          ? new Response(REGISTRY_ICON, {
              headers: { "content-type": "application/octet-stream" },
            })
          : new Response("missing", { status: 404 }),
      ),
  );
});

const ATTENDANCE = PluginId.parse("attendance");
const REMOTE_ICON = "https://registry.example/attendance.svg";
const REGISTRY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
// What the latest Registry check offered: the handler reads it on every request.
let registryIcons = new Map<string, string>();

test("a Plugin the Registry offers has its Registry icon served as SVG, readable cross-origin", async () => {
  registryIcons = new Map([[registryIconUrl(ATTENDANCE), REMOTE_ICON]]);
  const response = await serve(new Request(registryIconUrl(ATTENDANCE)));

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(await response.text()).toBe(REGISTRY_ICON);
});

test("a Registry icon the Registry does not serve, or a Plugin it no longer offers, is refused", async () => {
  registryIcons = new Map([
    [registryIconUrl(ATTENDANCE), "https://registry.example/gone.svg"],
  ]);
  expect((await serve(new Request(registryIconUrl(ATTENDANCE)))).status).toBe(
    404,
  );

  registryIcons = new Map();
  expect((await serve(new Request(registryIconUrl(ATTENDANCE)))).status).toBe(
    404,
  );
});

test("an installed Plugin's icon URL serves its icon.svg as SVG, readable cross-origin", async () => {
  const response = await serve(new Request(pluginIconUrl(CLASS_TIMER)));

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(await response.text()).toBe(ICON);
});

test("a Plugin installed after the handler was made has its icon served", async () => {
  const [classTimer] = installedPlugins;
  if (classTimer === undefined) throw new Error("no fixture");
  const before = installedPlugins;
  installedPlugins = [
    ...before,
    { ...classTimer, manifest: { ...classTimer.manifest, id: ATTENDANCE } },
  ];
  try {
    const response = await serve(new Request(pluginIconUrl(ATTENDANCE)));
    expect(await response.text()).toBe(ICON);
  } finally {
    installedPlugins = before;
  }
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
