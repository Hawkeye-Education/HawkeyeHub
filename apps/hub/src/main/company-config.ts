// The Company Configuration (ADRs 0002, 0005, 0006; spec #99): `company-config.json` on the
// Registry's rolling `registry` release, fetched once per start, parsed strictly, and kept as the
// last good copy in the Hub's data folder.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RoleName } from "@hawkeye-hub/plugin-format";
import { z } from "zod";
import { ThemeNameSchema } from "../shared/hub-settings";
import type { Diagnostics, HubEvent } from "./diagnostics";
import { errorCode } from "./error-code";
import type { AbsolutePath } from "./ids";
import { HAWKEYE } from "./lifecycle";
import { WebUrl, type RegistryFetch } from "./registry";

/**
 * Strict throughout: an older Hub rejects a field it does not know and falls back to its cache, so
 * a field is published only once the Hubs that read it have shipped. It holds no secrets: the OIDC
 * client is a public PKCE client (ADR 0005).
 */
const CompanyConfigurationSchema = z.strictObject({
  theme: ThemeNameSchema,
  // `ldap` joins when someone needs direct LDAP; until then Keycloak fronts it (ADR 0002).
  authProvider: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({
      kind: z.literal("oidc"),
      issuer: WebUrl,
      clientId: z.string().min(1),
      // Only with an Auth Provider: it means nothing without one.
      signInLifetime: z.strictObject({ hours: z.number().int().positive() }),
    }),
  ]),
  roleMapping: z.array(
    z.strictObject({ group: z.string().min(1), roles: z.array(RoleName) }),
  ),
});

export type CompanyConfiguration = z.infer<typeof CompanyConfigurationSchema>;

/** What the Hub uses with neither a fresh copy nor a cache: a first launch offline. */
export const BUILT_IN_COMPANY_CONFIGURATION: CompanyConfiguration = {
  theme: HAWKEYE,
  authProvider: { kind: "none" },
  roleMapping: [],
};

export type CompanyConfigurationFetchFailure =
  { kind: "http-status"; status: number } | { kind: "no-response" };

export type FetchedCompanyConfiguration =
  | { kind: "fetched"; text: string }
  | { kind: "failed"; failure: CompanyConfigurationFetchFailure };

export type CachedCompanyConfiguration =
  { kind: "missing" } | { kind: "read"; text: string } | { kind: "unreadable" };

export interface CompanyConfigurationResolution {
  configuration: CompanyConfiguration;
  source: "fetched" | "cache" | "built-in";
  /** What to write to hub.log, in order: never the file's contents. */
  events: HubEvent[];
}

function parse(text: string): CompanyConfiguration | "invalid" {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // JSON.parse throws only a SyntaxError, for text that is not JSON.
    return "invalid";
  }
  const parsed = CompanyConfigurationSchema.safeParse(json);
  return parsed.success ? parsed.data : "invalid";
}

/** The cache, or the built-in fallback; whether a bad cache was passed over. */
function fromCache(cached: CachedCompanyConfiguration): {
  configuration: CompanyConfiguration;
  source: "cache" | "built-in";
  cacheInvalid: boolean;
} {
  const configuration = cached.kind === "read" ? parse(cached.text) : "invalid";
  return configuration === "invalid"
    ? {
        configuration: BUILT_IN_COMPANY_CONFIGURATION,
        source: "built-in",
        cacheInvalid: cached.kind !== "missing",
      }
    : { configuration, source: "cache", cacheInvalid: false };
}

/** In order: a fresh fetch that parses, then the cache, then the built-in fallback. */
export function resolveCompanyConfiguration(
  fetched: FetchedCompanyConfiguration,
  cached: CachedCompanyConfiguration,
): CompanyConfigurationResolution {
  const events: HubEvent[] = [];
  if (fetched.kind === "fetched") {
    const configuration = parse(fetched.text);
    if (configuration !== "invalid") {
      return { configuration, source: "fetched", events };
    }
    events.push({ kind: "company-config-invalid", copy: "fetched" });
  } else {
    events.push({
      kind: "company-config-fetch-failed",
      failure: fetched.failure,
    });
  }
  const { configuration, source, cacheInvalid } = fromCache(cached);
  if (cacheInvalid) {
    events.push({ kind: "company-config-invalid", copy: "cached" });
  }
  events.push({ kind: "company-config-fallback", to: source });
  return { configuration, source, events };
}

/** The asset beside the Registry's `index.json`, so `HAWKEYE_HUB_REGISTRY_URL` moves both. */
export function companyConfigurationUrlFrom(registryUrl: URL): URL {
  return new URL(CACHE_FILE, registryUrl);
}

/** How long the start's fetch waits for the whole file: it is small, and the window never waits. */
const FETCH_TIMEOUT_MS = 10_000;

/** The cache's name in the Hub's data folder, the same as the published asset's. */
const CACHE_FILE = "company-config.json";

function readCache(dataDir: AbsolutePath): CachedCompanyConfiguration {
  try {
    return {
      kind: "read",
      text: readFileSync(join(dataDir, CACHE_FILE), "utf8"),
    };
  } catch (error) {
    // Not swallowed: an unreadable cache is logged as an invalid one when it is consulted.
    return errorCode(error) === "ENOENT"
      ? { kind: "missing" }
      : { kind: "unreadable" };
  }
}

/** What the Hub starts with before the fetch answers: the cache, or the built-in fallback. */
export function cachedCompanyConfiguration(
  dataDir: AbsolutePath,
): CompanyConfiguration {
  return fromCache(readCache(dataDir)).configuration;
}

async function fetchConfiguration(
  url: URL,
  fetch: RegistryFetch,
): Promise<FetchedCompanyConfiguration> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url.href, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    text = await response.text();
  } catch {
    // Not swallowed: as in `checkRegistry`, fetch rejects with a TypeError, or an abort's
    // DOMException, for every failure to get a whole response, which the caller logs.
    return { kind: "failed", failure: { kind: "no-response" } };
  }
  return response.ok
    ? { kind: "fetched", text }
    : {
        kind: "failed",
        failure: { kind: "http-status", status: response.status },
      };
}

export interface RefreshDeps {
  url: URL;
  fetch: RegistryFetch;
  dataDir: AbsolutePath;
  diagnostics: Diagnostics;
}

/**
 * Fetches once and resolves (`resolveCompanyConfiguration`), logging what went wrong. A fresh copy
 * that parses replaces the cache whole, through a temporary file. The Registry check loop will
 * re-fetch through this too (ADR 0005).
 */
export async function refreshCompanyConfiguration({
  url,
  fetch,
  dataDir,
  diagnostics,
}: RefreshDeps): Promise<CompanyConfiguration> {
  const fetched = await fetchConfiguration(url, fetch);
  const { configuration, source, events } = resolveCompanyConfiguration(
    fetched,
    readCache(dataDir),
  );
  for (const event of events) diagnostics.recordHubEvent(event);
  if (source === "fetched") {
    const path = join(dataDir, CACHE_FILE);
    writeFileSync(`${path}.tmp`, `${JSON.stringify(configuration, null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
  }
  return configuration;
}

/** Dev mode's `--company-config` file. One that cannot be read or parsed throws with why. */
export function readCompanyConfigurationFile(
  path: AbsolutePath,
): CompanyConfiguration {
  const configuration = parse(readFileSync(path, "utf8"));
  if (configuration === "invalid") {
    throw new Error(`${path} is not a valid Company Configuration`);
  }
  return configuration;
}
