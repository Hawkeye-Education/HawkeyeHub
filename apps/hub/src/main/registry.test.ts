import { expect, test } from "vitest";
import { parseHubApiVersion } from "./ids";
import {
  checkRegistry,
  REGISTRY_URL,
  registryUrlFrom,
  type RegistryFetch,
} from "./registry";

const INDEX_URL = "https://registry.example/index.json";
const HUB_API = parseHubApiVersion("1.2.0");
const SHA = "a".repeat(64);

function manifest(
  id: string,
  version: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    version,
    hubApi: "^1.0.0",
    name: { "en-HK": "Seating Plan", "zh-HK": "座位表" },
    description: "Plan where students sit.",
    platforms: ["win32-x64", "darwin-arm64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "none" },
    assistant: { kind: "none" },
    ...overrides,
  };
}

function entry(manifestJson: Record<string, unknown>) {
  const { id, version } = manifestJson as { id: string; version: string };
  return {
    manifest: manifestJson,
    url: `https://registry.example/${id}-${version}.zip`,
    sha256: SHA,
    iconUrl: `https://registry.example/${id}-${version}.svg`,
  };
}

/** A Registry answering `body` with `status` at INDEX_URL only. */
function serving(body: string, status = 200): RegistryFetch {
  return (url) =>
    Promise.resolve(
      url === INDEX_URL
        ? new Response(body, { status })
        : new Response(null, { status: 404 }),
    );
}

function index(plugins: Record<string, unknown[]>): RegistryFetch {
  return serving(JSON.stringify({ plugins }));
}

function check(fetch: RegistryFetch) {
  return checkRegistry({
    url: new URL(INDEX_URL),
    fetch,
    platform: "win32-x64",
    hubApiVersion: HUB_API,
  });
}

/** Each listed Plugin as `id@version: access`, for tests about which version is chosen. */
async function chosen(plugins: Record<string, unknown[]>): Promise<string[]> {
  const result = await check(index(plugins));
  if (result.kind !== "listed") throw new Error(`check ${result.kind}`);
  return result.plugins.map(
    ({ manifest: { id, version }, access }) =>
      `${id}@${version}: ${access.kind === "blocked" ? access.reason : access.kind}`,
  );
}

test("a Plugin with one version is listed with its Manifest, package and icon", async () => {
  const seating = entry(manifest("seating-plan", "1.0.0"));

  const result = await check(index({ "seating-plan": [seating] }));

  expect(result).toEqual({
    kind: "listed",
    plugins: [
      {
        manifest: seating.manifest,
        url: seating.url,
        sha256: SHA,
        iconUrl: seating.iconUrl,
        access: { kind: "installable" },
      },
    ],
  });
});

test("the newest version is chosen, whatever order the index lists them in", async () => {
  expect(
    await chosen({
      "seating-plan": [
        entry(manifest("seating-plan", "1.2.0")),
        entry(manifest("seating-plan", "1.10.0")),
        entry(manifest("seating-plan", "1.9.0")),
      ],
    }),
  ).toEqual(["seating-plan@1.10.0: installable"]);
});

test.each([
  ["not for this computer", { platforms: ["darwin-arm64"] }],
  ["needing sign-in", { identity: { kind: "required", roles: [] } }],
  ["needing a different Hub", { hubApi: "^2.0.0" }],
])(
  "a newest version %s is passed over for the newest one that passes",
  async (_what, overrides) => {
    expect(
      await chosen({
        "seating-plan": [
          entry(manifest("seating-plan", "1.0.0")),
          entry(manifest("seating-plan", "2.0.0", overrides)),
        ],
      }),
    ).toEqual(["seating-plan@1.0.0: installable"]);
  },
);

test.each([
  ["not-for-this-computer", { platforms: ["darwin-arm64"] }],
  ["needs-sign-in", { identity: { kind: "required", roles: [] } }],
  ["needs-different-hub", { hubApi: "^2.0.0" }],
])(
  "with no version passing, the newest is listed, blocked: %s",
  async (reason, overrides) => {
    expect(
      await chosen({
        "seating-plan": [
          entry(
            manifest("seating-plan", "1.0.0", { platforms: ["darwin-arm64"] }),
          ),
          entry(manifest("seating-plan", "2.0.0", overrides)),
        ],
      }),
    ).toEqual([`seating-plan@2.0.0: ${reason}`]);
  },
);

test("the gates run in order: Supported Platforms, then sign-in, then the Hub API", async () => {
  expect(
    await chosen({
      "seating-plan": [
        entry(
          manifest("seating-plan", "1.0.0", {
            platforms: ["darwin-arm64"],
            identity: { kind: "required", roles: [] },
            hubApi: "^2.0.0",
          }),
        ),
      ],
      attendance: [
        entry(
          manifest("attendance", "1.0.0", {
            identity: { kind: "required", roles: [] },
            hubApi: "^2.0.0",
          }),
        ),
      ],
    }),
  ).toEqual([
    "seating-plan@1.0.0: not-for-this-computer",
    "attendance@1.0.0: needs-sign-in",
  ]);
});

test("an entry whose Manifest is invalid, or whose id disagrees with its key, is left out; the rest still list", async () => {
  expect(
    await chosen({
      "seating-plan": [
        entry(manifest("seating-plan", "1.0.0")),
        entry(manifest("seating-plan", "2.0.0", { platforms: [] })),
      ],
      attendance: [entry(manifest("class-timer", "3.0.0"))],
      "class-timer": [entry(manifest("class-timer", "1.0.0"))],
    }),
  ).toEqual([
    "seating-plan@1.0.0: installable",
    "class-timer@1.0.0: installable",
  ]);
});

test("an HTTP error status fails the check with the status", async () => {
  expect(await check(serving("Not Found", 404))).toEqual({
    kind: "failed",
    failure: { kind: "http-status", status: 404 },
  });
});

test("no response fails the check", async () => {
  expect(
    await check(() => Promise.reject(new TypeError("fetch failed"))),
  ).toEqual({ kind: "failed", failure: { kind: "no-response" } });
});

test.each([
  ["not JSON", "<html>"],
  ["no plugins map", JSON.stringify({})],
  [
    "an entry missing its checksum",
    JSON.stringify({
      plugins: {
        "seating-plan": [
          { ...entry(manifest("seating-plan", "1.0.0")), sha256: undefined },
        ],
      },
    }),
  ],
  [
    "a key that is not a Plugin id",
    JSON.stringify({ plugins: { "Not An Id": [] } }),
  ],
])("an index with %s fails the check as invalid", async (_what, body) => {
  expect(await check(serving(body))).toEqual({
    kind: "failed",
    failure: { kind: "invalid" },
  });
});

test("the Registry URL is the registry release's index.json, unless HAWKEYE_HUB_REGISTRY_URL overrides it", () => {
  expect(registryUrlFrom({}).href).toBe(REGISTRY_URL);
  expect(REGISTRY_URL).toBe(
    "https://github.com/Hawkeye-Education/HawkeyeHub/releases/download/registry/index.json",
  );
  expect(
    registryUrlFrom({
      HAWKEYE_HUB_REGISTRY_URL: "http://127.0.0.1:8080/index.json",
    }).href,
  ).toBe("http://127.0.0.1:8080/index.json");
  expect(() =>
    registryUrlFrom({ HAWKEYE_HUB_REGISTRY_URL: "not a url" }),
  ).toThrow();
});
