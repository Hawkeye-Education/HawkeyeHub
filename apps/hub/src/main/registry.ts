// The Registry client (ADR 0005, spec #91): fetches the rolling `registry` release's `index.json`,
// parses it at the boundary, and chooses for each Plugin the version this Hub could install.

import { parseManifest, type Manifest } from "@hawkeye-hub/plugin-format";
// The index schema lives beside its generator, so the Hub parses exactly what CI writes.
import {
  RegistryIndex,
  type Sha256,
  type WebUrl,
} from "@hawkeye-hub/plugin-format/registry-index";
import semver from "semver";
import type { CatalogueAccess } from "../shared/hub-chrome-ipc";
import type { HubApiVersion } from "./ids";
import { accessOf } from "./lifecycle";

export { Sha256, WebUrl } from "@hawkeye-hub/plugin-format/registry-index";

export const REGISTRY_URL =
  "https://github.com/Hawkeye-Education/HawkeyeHub/releases/download/registry/index.json";

/** An installed Hub checks at launch and this often after (spec #91). */
export const REGISTRY_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** How long a check waits for the whole index before it counts as no response. */
const REGISTRY_TIMEOUT_MS = 30_000;

/** The Registry URL: `HAWKEYE_HUB_REGISTRY_URL`, for tests and local fixtures, or REGISTRY_URL. */
export function registryUrlFrom(env: NodeJS.ProcessEnv): URL {
  // Absence is a real state: the Hub then uses the company Registry.
  return new URL(env["HAWKEYE_HUB_REGISTRY_URL"] ?? REGISTRY_URL);
}

/** This computer as a Manifest's Supported Platforms name one, such as `win32-x64`. */
export type HostPlatform = `${NodeJS.Platform}-${NodeJS.Architecture}`;

/** The version of a Plugin the Catalogue lists, and whether this Hub can install it. */
export interface RegistryPlugin {
  manifest: Manifest;
  url: WebUrl;
  sha256: Sha256;
  iconUrl: WebUrl;
  access: CatalogueAccess;
}

/** How a fetch from the web failed to get a good answer: an HTTP error, or no whole response. */
export type FetchFailure =
  { kind: "http-status"; status: number } | { kind: "no-response" };

export type RegistryCheckFailure = FetchFailure | { kind: "invalid" };

export type RegistryCheck =
  | { kind: "listed"; plugins: RegistryPlugin[] }
  | { kind: "failed"; failure: RegistryCheckFailure };

/** `fetch`, or Electron's `net.fetch`: injected so tests need no network. */
export type RegistryFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>;

export interface RegistryCheckDeps {
  url: URL;
  fetch: RegistryFetch;
  platform: HostPlatform;
  hubApiVersion: HubApiVersion;
}

/**
 * Fetches and parses the index. An entry whose Manifest is invalid, or names another id than its
 * key, is left out. Each Plugin is listed at the newest version passing every gate, or, if none
 * does, at its newest version with why it is blocked.
 */
export async function checkRegistry({
  url,
  fetch,
  platform,
  hubApiVersion,
}: RegistryCheckDeps): Promise<RegistryCheck> {
  let response: Response;
  let body: string;
  try {
    response = await fetch(url.href, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    body = await response.text();
  } catch {
    // Not swallowed: any failure to get a whole response is the `no-response` outcome, logged by
    // the caller. fetch rejects with a TypeError, or an abort's DOMException, for every such case.
    return failed({ kind: "no-response" });
  }
  if (!response.ok) {
    return failed({ kind: "http-status", status: response.status });
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) return failed({ kind: "invalid" });
    throw error;
  }
  const index = RegistryIndex.safeParse(json);
  if (!index.success) return failed({ kind: "invalid" });

  const plugins: RegistryPlugin[] = [];
  for (const [id, entries] of Object.entries(index.data.plugins)) {
    const versions = entries
      .flatMap((entry) => {
        const parsed = parseManifest(entry.manifest);
        return parsed.kind === "valid" && parsed.manifest.id === id
          ? [{ ...entry, manifest: parsed.manifest }]
          : [];
      })
      .map((entry) => ({
        ...entry,
        access: catalogueAccessOf(entry.manifest, platform, hubApiVersion),
      }))
      .sort((a, b) => semver.rcompare(a.manifest.version, b.manifest.version));
    const choice =
      versions.find(({ access }) => access.kind === "installable") ??
      versions[0];
    if (choice !== undefined) plugins.push(choice);
  }
  return { kind: "listed", plugins };
}

function failed(failure: RegistryCheckFailure): RegistryCheck {
  return { kind: "failed", failure };
}

/**
 * ADR 0005's gates, in order: Supported Platforms, then `accessOf` (sign-in, then `hubApi`).
 */
function catalogueAccessOf(
  manifest: Manifest,
  platform: HostPlatform,
  hubApiVersion: HubApiVersion,
): CatalogueAccess {
  if (!manifest.platforms.some((supported) => supported === platform)) {
    return { kind: "blocked", reason: "not-for-this-computer" };
  }
  const access = accessOf(manifest, hubApiVersion);
  if (access.kind === "blocked") return access;
  return { kind: "installable" };
}
