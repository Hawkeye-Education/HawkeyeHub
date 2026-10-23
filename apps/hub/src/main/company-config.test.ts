import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  cachedCompanyConfiguration,
  companyConfigurationUrlFrom,
  readCompanyConfigurationFile,
  refreshCompanyConfiguration,
  resolveCompanyConfiguration,
} from "./company-config";
import { openDiagnostics } from "./diagnostics";
import { parseAbsolutePath } from "./ids";
import type { RegistryFetch } from "./registry";

const OIDC = {
  theme: "harbour",
  authProvider: {
    kind: "oidc",
    issuer: "https://sso.hawkeye.example/realms/staff",
    clientId: "hawkeye-hub",
    signInLifetime: { hours: 168 },
  },
  roleMapping: [{ group: "teachers", roles: ["teacher"] }],
};
const CACHED = { ...OIDC, theme: "hawkeye" };
const BUILT_IN = {
  theme: "hawkeye",
  authProvider: { kind: "none" },
  roleMapping: [],
};

const fetched = (json: unknown) => ({
  kind: "fetched" as const,
  text: JSON.stringify(json),
});
const cached = (json: unknown) => ({
  kind: "read" as const,
  text: JSON.stringify(json),
});
const NO_RESPONSE = {
  kind: "failed" as const,
  failure: { kind: "no-response" as const },
};

test("a fresh fetch that parses is used, and nothing is logged", () => {
  expect(resolveCompanyConfiguration(fetched(OIDC), cached(CACHED))).toEqual({
    configuration: OIDC,
    source: "fetched",
    events: [],
  });
});

test("a fresh fetch that does not parse falls back to the cache, and both are logged", () => {
  expect(
    resolveCompanyConfiguration(
      { kind: "fetched", text: "{ theme: harbour" },
      cached(CACHED),
    ),
  ).toEqual({
    configuration: CACHED,
    source: "cached",
    events: [
      { kind: "company-config-invalid", copy: "fetched" },
      { kind: "company-config-fallback", to: "cached" },
    ],
  });
});

test("a failed fetch falls back to the cache, and both are logged", () => {
  expect(
    resolveCompanyConfiguration(
      { kind: "failed", failure: { kind: "http-status", status: 404 } },
      cached(CACHED),
    ),
  ).toEqual({
    configuration: CACHED,
    source: "cached",
    events: [
      {
        kind: "company-config-fetch-failed",
        failure: { kind: "http-status", status: 404 },
      },
      { kind: "company-config-fallback", to: "cached" },
    ],
  });
});

test("with no cache either, the Hub has no Auth Provider and the Hawkeye Theme", () => {
  expect(resolveCompanyConfiguration(NO_RESPONSE, { kind: "missing" })).toEqual(
    {
      configuration: BUILT_IN,
      source: "built-in",
      events: [
        {
          kind: "company-config-fetch-failed",
          failure: { kind: "no-response" },
        },
        { kind: "company-config-fallback", to: "built-in" },
      ],
    },
  );
});

test.each([
  ["is not JSON", { kind: "read" as const, text: "{" }],
  ["fails the schema", cached({ ...CACHED, roleMapping: "teachers" })],
])(
  "a cache that %s is treated as no cache, and logged as invalid",
  (_, cache) => {
    expect(resolveCompanyConfiguration(NO_RESPONSE, cache)).toEqual({
      configuration: BUILT_IN,
      source: "built-in",
      events: [
        {
          kind: "company-config-fetch-failed",
          failure: { kind: "no-response" },
        },
        { kind: "company-config-invalid", copy: "cached" },
        { kind: "company-config-fallback", to: "built-in" },
      ],
    });
  },
);

test.each([
  ["a field this Hub does not know", { ...OIDC, signInPage: "/login" }],
  [
    "an Auth Provider field this Hub does not know",
    { ...OIDC, authProvider: { ...OIDC.authProvider, scopes: ["openid"] } },
  ],
  ["a missing field", { theme: "harbour", authProvider: { kind: "none" } }],
  [
    "a Sign-in Lifetime without an Auth Provider",
    {
      ...BUILT_IN,
      authProvider: { kind: "none", signInLifetime: { hours: 1 } },
    },
  ],
  ["the ldap kind", { ...OIDC, authProvider: { kind: "ldap" } }],
  [
    "an issuer that is not a URL",
    { ...OIDC, authProvider: { ...OIDC.authProvider, issuer: "sso" } },
  ],
])("a fetched copy with %s is rejected", (_, json) => {
  expect(
    resolveCompanyConfiguration(fetched(json), cached(CACHED)),
  ).toMatchObject({ configuration: CACHED, source: "cached" });
});

test("the Company Configuration sits beside the Registry's index on the registry release", () => {
  expect(
    companyConfigurationUrlFrom(
      new URL(
        "https://github.com/Hawkeye-Education/HawkeyeHub/releases/download/registry/index.json",
      ),
    ).href,
  ).toBe(
    "https://github.com/Hawkeye-Education/HawkeyeHub/releases/download/registry/company-config.json",
  );
});

const CONFIG_URL = new URL("https://registry.example/company-config.json");

/** A Registry answering `body` with `status` at CONFIG_URL only. */
function serving(body: string, status = 200): RegistryFetch {
  return (url) =>
    Promise.resolve(
      url === CONFIG_URL.href
        ? new Response(body, { status })
        : new Response(null, { status: 404 }),
    );
}
const unreachable: RegistryFetch = () =>
  Promise.reject(new TypeError("fetch failed"));

function hubFolders() {
  const dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-data-")));
  const logsDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-logs-")));
  const diagnostics = openDiagnostics(logsDir, () => new Date());
  const refresh = (fetch: RegistryFetch) =>
    refreshCompanyConfiguration({
      url: CONFIG_URL,
      fetch,
      dataDir,
      diagnostics,
    });
  const hubLog = (): string[] =>
    readFileSync(join(logsDir, "hub.log"), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => (JSON.parse(line) as { message: string }).message);
  return { dataDir, refresh, hubLog };
}

test("a fetched copy is cached, and a later start that cannot fetch uses it", async () => {
  const { dataDir, refresh, hubLog } = hubFolders();
  expect(cachedCompanyConfiguration(dataDir)).toEqual(BUILT_IN);

  expect(await refresh(serving(JSON.stringify(OIDC)))).toEqual(OIDC);
  expect(cachedCompanyConfiguration(dataDir)).toEqual(OIDC);

  expect(await refresh(unreachable)).toEqual(OIDC);
  expect(hubLog()).toEqual([
    "Company Configuration fetch failed: gave no response",
    "Company Configuration: using the cached copy",
  ]);
});

test("a copy that does not parse leaves the cache as it was", async () => {
  const { dataDir, refresh, hubLog } = hubFolders();
  await refresh(serving(JSON.stringify(OIDC)));

  expect(await refresh(serving(JSON.stringify({ ...OIDC, extra: 1 })))).toEqual(
    OIDC,
  );
  expect(await refresh(serving("Not Found", 404))).toEqual(OIDC);
  expect(cachedCompanyConfiguration(dataDir)).toEqual(OIDC);
  expect(hubLog()).toEqual([
    "Company Configuration invalid: the fetched copy",
    "Company Configuration: using the cached copy",
    "Company Configuration fetch failed: returned HTTP 404",
    "Company Configuration: using the cached copy",
  ]);
});

test("a first launch offline uses the built-in fallback and caches nothing", async () => {
  const { dataDir, refresh, hubLog } = hubFolders();
  expect(await refresh(unreachable)).toEqual(BUILT_IN);
  expect(hubLog()).toEqual([
    "Company Configuration fetch failed: gave no response",
    "Company Configuration: using the built-in fallback",
  ]);
  expect(existsSync(join(dataDir, "company-config.json"))).toBe(false);
});

test("a fetched copy that cannot be cached is logged and still used", async () => {
  const logsDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-logs-")));
  // A data folder that is gone: the cache write fails with ENOENT, as a full disk fails with ENOSPC.
  const dataDir = parseAbsolutePath(join(logsDir, "gone"));
  expect(
    await refreshCompanyConfiguration({
      url: CONFIG_URL,
      fetch: serving(JSON.stringify(OIDC)),
      dataDir,
      diagnostics: openDiagnostics(logsDir, () => new Date()),
    }),
  ).toEqual(OIDC);
  expect(readFileSync(join(logsDir, "hub.log"), "utf8")).toContain(
    '"message":"Company Configuration could not be cached: ENOENT"',
  );
});

test("an unreadable cache is logged with why, apart from one that does not parse", async () => {
  const { dataDir, refresh, hubLog } = hubFolders();
  // A folder where the cache file should be: reading it fails, but not with ENOENT.
  mkdirSync(join(dataDir, "company-config.json"));
  expect(await refresh(unreachable)).toEqual(BUILT_IN);
  expect(hubLog()).toEqual([
    "Company Configuration fetch failed: gave no response",
    "Company Configuration cache unreadable: EISDIR",
    "Company Configuration: using the built-in fallback",
  ]);
});

test("dev mode's local file is read and parsed, and one that does not parse throws with why", () => {
  const folder = mkdtempSync(join(tmpdir(), "company-config-"));
  const path = parseAbsolutePath(join(folder, "company-config.json"));
  writeFileSync(path, JSON.stringify(OIDC));
  expect(readCompanyConfigurationFile(path)).toEqual(OIDC);
  writeFileSync(path, JSON.stringify({ ...OIDC, extra: 1 }));
  expect(() => readCompanyConfigurationFile(path)).toThrow(
    `${path} is not a valid Company Configuration`,
  );
});
