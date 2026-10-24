// The Registry's `index.json` (ADRs 0005, 0011): its schema, which the Hub parses it with, and the
// generator `release-plugin.yml` runs. The index is rebuilt from every Plugin release, never
// patched, so concurrent tags and reruns cannot corrupt it.

import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import semver from "semver";
import { z } from "zod";
import { parseManifest, PluginId, type Manifest } from "./manifest.ts";

// A package or icon is only ever fetched over the web, never from a local file.
export const WebUrl = z.url({ protocol: /^https?$/ }).brand<"WebUrl">();
export type WebUrl = z.infer<typeof WebUrl>;
export const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<"Sha256">();
export type Sha256 = z.infer<typeof Sha256>;

// One published version. The Hub parses the Manifest on its own, so a bad one leaves out only itself.
const IndexEntry = z.strictObject({
  manifest: z.unknown(),
  url: WebUrl,
  sha256: Sha256,
  iconUrl: WebUrl,
});
export const RegistryIndex = z.strictObject({
  plugins: z.record(PluginId, z.array(IndexEntry)),
});

/** One `plugin/<id>@<version>` release: its asset URLs, and the bytes of its Plugin Package. */
export interface PluginRelease {
  tag: string;
  packageUrl: string;
  iconUrl: string;
  packageZip: Uint8Array;
}

/**
 * The `index.json` text for `releases`: each Plugin's versions newest first, Plugins by id, so the
 * same releases in any order give the same bytes. Throws on a release that disagrees with itself.
 */
export function registryIndexFrom(releases: PluginRelease[]): string {
  const entries = releases
    .map((release) => {
      const manifest = packedManifest(release);
      return {
        manifest,
        entry: {
          manifest,
          url: WebUrl.parse(release.packageUrl),
          sha256: createHash("sha256").update(release.packageZip).digest("hex"),
          iconUrl: WebUrl.parse(release.iconUrl),
        },
      };
    })
    .sort(
      (a, b) =>
        a.manifest.id.localeCompare(b.manifest.id, "en") ||
        semver.rcompare(a.manifest.version, b.manifest.version),
    );
  const plugins: Record<string, unknown[]> = {};
  for (const { manifest, entry } of entries) {
    (plugins[manifest.id] ??= []).push(entry);
  }
  return `${JSON.stringify({ plugins }, null, 2)}\n`;
}

function packedManifest({ tag, packageZip }: PluginRelease): Manifest {
  const file = unzipSync(packageZip, {
    filter: ({ name }) => name === "manifest.json",
  })["manifest.json"];
  if (file === undefined) throw new Error(`${tag} has no manifest.json`);
  const parsed = parseManifest(JSON.parse(strFromU8(file)));
  if (parsed.kind === "invalid") {
    throw new Error(`${tag} has an invalid manifest.json: ${parsed.reason}`);
  }
  const { id, version } = parsed.manifest;
  if (tag !== `plugin/${id}@${version}`) {
    throw new Error(`${tag} holds ${id} ${version}`);
  }
  return parsed.manifest;
}
