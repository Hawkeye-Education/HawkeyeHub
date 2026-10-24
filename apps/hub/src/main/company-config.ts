// The Company Configuration (ADRs 0002, 0005, 0006; spec #99): `company-config.json` on the
// Registry's rolling `registry` release, fetched once per start, parsed strictly, and kept as the
// last good copy in the Hub's data folder.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RoleName } from "@hawkeye-hub/plugin-format";
import { z } from "zod";
import { ThemeNameSchema } from "../shared/hub-settings";
import type { Diagnostics, HubEvent, SystemDescription } from "./diagnostics";
import { errorCode } from "./error-code";
import type { AbsolutePath } from "./ids";
import { HAWKEYE } from "./lifecycle";
import { WebUrl, type FetchFailure, type RegistryFetch } from "./registry";

/** The OIDC client the Hub signs in as, registered with the Auth Provider. */
const ClientId = z.string().min(1).brand<"ClientId">();
/** A group in the Auth Provider, as its token names it, that the Role Mapping maps to Roles. */
const GroupName = z.string().min(1).brand<"GroupName">();

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
      clientId: ClientId,
      // Only with an Auth Provider: it means nothing without one.
      signInLifetime: z.strictObject({ hours: z.number().int().positive() }),
    }),
  ]),
  roleMapping: z.array(
    z.strictObject({ group: GroupName, roles: z.array(RoleName) }),
  ),
});

export type CompanyConfiguration = z.infer<typeof CompanyConfigurationSchema>;
export type ClientId = z.infer<typeof ClientId>;

/** What the Hub uses with neither a fresh copy nor a cache: a first launch offline. */
export const BUILT_IN_COMPANY_CONFIGURATION: CompanyConfiguration = {
  theme: HAWKEYE,
  authProvider: { kind: "none" },
  roleMapping: [],
};

export type FetchedCompanyConfiguration =
  { kind: "fetched"; text: string } | { kind: "failed"; failure: FetchFailure };

export type CachedCompanyConfiguration =
  | { kind: "missing" }
  | { kind: "read"; text: string }
  // The fs error's code, such as `EACCES` or `EBUSY`.
  | { kind: "unreadable"; code: string };

export interface CompanyConfigurationResolution {
  configuration: CompanyConfiguration;
  source: "fetched" | "cached" | "built-in";
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

/** The cache, or the built-in fallback, and why a cache was passed over. */
function fromCache(cached: CachedCompanyConfiguration): {
  configuration: CompanyConfiguration;
  source: "cached" | "built-in";
  events: HubEvent[];
} {
  const builtIn = (events: HubEvent[]) => ({
    configuration: BUILT_IN_COMPANY_CONFIGURATION,
    source: "built-in" as const,
    events,
  });
  switch (cached.kind) {
    case "missing":
      return builtIn([]);
    case "unreadable":
      return builtIn([
        { kind: "company-config-cache-unreadable", code: cached.code },
      ]);
    case "read": {
      const configuration = parse(cached.text);
      return configuration === "invalid"
        ? builtIn([{ kind: "company-config-invalid", copy: "cached" }])
        : { configuration, source: "cached", events: [] };
    }
    default:
      return cached satisfies never;
  }
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
  const fallback = fromCache(cached);
  const { configuration, source } = fallback;
  events.push(...fallback.events);
  events.push({ kind: "company-config-fallback", to: source });
  return { configuration, source, events };
}

/** The asset beside the Registry's `index.json`, so `HAWKEYE_HUB_REGISTRY_URL` moves both. */
export function companyConfigurationUrlFrom(registryUrl: URL): URL {
  return new URL(FILE_NAME, registryUrl);
}

/** How long the start's fetch waits for the whole file: it is small, and the window never waits. */
const FETCH_TIMEOUT_MS = 10_000;

/** The published asset's name, and the cache's in the Hub's data folder. */
const FILE_NAME = "company-config.json";

function readCache(dataDir: AbsolutePath): CachedCompanyConfiguration {
  try {
    return {
      kind: "read",
      text: readFileSync(join(dataDir, FILE_NAME), "utf8"),
    };
  } catch (error) {
    // Not swallowed: an unreadable cache is logged, with its code, when it is consulted.
    const code = errorCode(error);
    if (code === undefined) throw error;
    return code === "ENOENT"
      ? { kind: "missing" }
      : { kind: "unreadable", code };
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
  if (source === "fetched") writeCache(dataDir, configuration, diagnostics);
  return configuration;
}

/**
 * Replaces the cache whole, through a temporary file. A cache that cannot be written (a full disk,
 * a locked file) is logged with the fs error's code, and the fresh copy is still used.
 */
function writeCache(
  dataDir: AbsolutePath,
  configuration: CompanyConfiguration,
  diagnostics: Diagnostics,
): void {
  const path = join(dataDir, FILE_NAME);
  try {
    writeFileSync(`${path}.tmp`, `${JSON.stringify(configuration, null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
  } catch (error) {
    const code = errorCode(error);
    if (code === undefined) throw error;
    diagnostics.recordHubEvent({
      kind: "company-config-cache-unwritable",
      code,
    });
  }
}

/** The Auth Provider as `system.json` reports it: no one is signed in until the sign-in spec. */
export function describeAuthProvider(
  authProvider: CompanyConfiguration["authProvider"],
): SystemDescription["authProvider"] {
  switch (authProvider.kind) {
    case "none":
      return { kind: "none" };
    case "oidc":
      return { kind: "oidc", signedIn: false };
    default:
      return authProvider satisfies never;
  }
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
