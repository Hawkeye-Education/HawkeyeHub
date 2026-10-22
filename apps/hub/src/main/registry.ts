// The Registry client (ADR 0005, spec #91): fetches the rolling `registry` release's `index.json`,
// parses it at the boundary, and chooses for each Plugin the version this Hub could install.

import {
  parseManifest,
  PluginId,
  type Manifest,
} from "@hawkeye-hub/plugin-format";
import semver from "semver";
import { z } from "zod";
import type { CatalogueAccess } from "../shared/hub-chrome-ipc";
import type { HubApiVersion } from "./ids";
import { accessOf } from "./lifecycle";

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

// A package or icon is only ever fetched over the web, never from a local file.
const WebUrl = z.url({ protocol: /^https?$/ }).brand<"WebUrl">();
export type WebUrl = z.infer<typeof WebUrl>;
const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<"Sha256">();
export type Sha256 = z.infer<typeof Sha256>;

// One published version. The Manifest is parsed on its own, so a bad one leaves out only itself.
const IndexEntry = z.strictObject({
  manifest: z.unknown(),
  url: WebUrl,
  sha256: Sha256,
  iconUrl: WebUrl,
});
const RegistryIndex = z.strictObject({
  plugins: z.record(PluginId, z.array(IndexEntry)),
});

/** The version of a Plugin the Catalogue lists, and whether this Hub can install it. */
export interface RegistryPlugin {
  manifest: Manifest;
  url: WebUrl;
  sha256: Sha256;
  iconUrl: WebUrl;
  access: CatalogueAccess;
}

export type RegistryCheckFailure =
  | { kind: "http-status"; status: number }
  | { kind: "no-response" }
  | { kind: "invalid" };

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
 * ADR 0005's gates, in order: Supported Platforms, then `accessOf` (sign-in, then `hubApi`). Then,
 * until the Python ticket lands, a Python Backend, which this Hub cannot build yet.
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
  if (manifest.backend.kind === "python") {
    return { kind: "blocked", reason: "python-not-yet-supported" };
  }
  return { kind: "installable" };
}
