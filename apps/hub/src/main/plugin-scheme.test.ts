import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PluginId } from "@hawkeye-hub/plugin-format";
import type { Session } from "electron";
import { expect, test, vi } from "vitest";
import { PLUGIN_SCHEME, servePluginUi, uiFileFor } from "./plugin-scheme";

// Electron's fetch, answering with the file URL it was asked for.
vi.mock("electron", () => ({
  net: { fetch: (url: string) => Promise.resolve(new Response(url)) },
}));

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

/** A partition's session, whose protocol throws on a second handle as Electron's does. */
function fakeSession() {
  const handlers = new Map<string, (request: Request) => Promise<Response>>();
  const protocol = {
    isProtocolHandled: (scheme: string) => handlers.has(scheme),
    handle: (
      scheme: string,
      handler: (request: Request) => Promise<Response>,
    ) => {
      if (handlers.has(scheme)) throw new Error(`${scheme} already handled`);
      handlers.set(scheme, handler);
    },
    unhandle: (scheme: string) => {
      handlers.delete(scheme);
    },
  };
  const served = async (url: string) => {
    const handler = handlers.get(PLUGIN_SCHEME);
    if (handler === undefined) throw new Error("not handled");
    return (await handler(new Request(url))).text();
  };
  return { session: { protocol } as unknown as Session, served };
}

test("each open serves the folder it names, so a reopen after an update or reinstall serves the new one", async () => {
  const { session, served } = fakeSession();
  const updated = resolve("/plugins/class-timer@1.1.0/ui");

  servePluginUi(session, TIMER, UI);
  servePluginUi(session, TIMER, updated);

  expect(await served("hawkeye-plugin://class-timer/index.html")).toBe(
    pathToFileURL(join(updated, "index.html")).toString(),
  );
});
