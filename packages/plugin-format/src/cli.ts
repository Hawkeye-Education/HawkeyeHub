// `pnpm plugin-format check|pack <dir>` (PLUGIN_STANDARD.md §10) and `index <file>` (ADR 0011).
// Node runs this file directly with type stripping, so local imports name their `.ts` file.
//   check <dir> [--tag plugin/<id>@<version>]   prints every problem, exits 1 if there are any
//   pack <dir>                                  writes out/<id>-<version>.zip, prints its sha256
//   index <file> [--tag plugin/<id>@<version>]  writes the Registry's index.json from every
//                                               Plugin release of $GITHUB_REPOSITORY, warns of
//                                               each bad one it leaves out, exits 1 if --tag is one
// pnpm runs root scripts in the repo root, so `<dir>` is relative to it (`plugins/<id>`).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import semver from "semver";
import { z } from "zod";
import { checkPlugin, type CheckContext } from "./check.ts";
import { packPlugin } from "./pack.ts";
import {
  registryIndexFrom,
  type PluginRelease,
  type SkippedRelease,
} from "./registry-index.ts";

const REPO = join(import.meta.dirname, "../../..");
const USAGE =
  "usage: plugin-format check <dir> [--tag plugin/<id>@<version>]\n       plugin-format pack <dir>\n       plugin-format index <file> [--tag plugin/<id>@<version>]";

function hubApiVersion(): string {
  const raw: unknown = JSON.parse(
    readFileSync(join(REPO, "packages/hub-api/package.json"), "utf8"),
  );
  const version =
    typeof raw === "object" && raw !== null && "version" in raw
      ? raw.version
      : null;
  if (typeof version !== "string" || semver.valid(version) !== version) {
    throw new Error("packages/hub-api/package.json has no semver version");
  }
  return version;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const GitHubReleases = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    assets: z.array(
      z.object({ name: z.string(), browser_download_url: z.string() }),
    ),
  }),
);
const RELEASES_PAGE_SIZE = 100;

/**
 * Every published `plugin/*` release of `repo`, with its Plugin Package downloaded, and those
 * whose assets are not one zip and one icon.svg, left out. A failed download throws: it may be
 * transient, and leaving the release out would drop it from the Catalogue.
 */
async function pluginReleases(
  repo: string,
  token: string,
): Promise<{ releases: PluginRelease[]; skipped: SkippedRelease[] }> {
  const releases: PluginRelease[] = [];
  const skipped: SkippedRelease[] = [];
  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=${String(RELEASES_PAGE_SIZE)}&page=${String(page)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub releases: HTTP ${String(response.status)}`);
    }
    const batch = GitHubReleases.parse(await response.json());
    // A draft is unpublished: a run that failed while uploading its assets can leave one.
    for (const release of batch.filter(
      (candidate) =>
        !candidate.draft && candidate.tag_name.startsWith("plugin/"),
    )) {
      const asset = (matches: (name: string) => boolean) => {
        const [only, ...others] = release.assets.filter((a) => matches(a.name));
        return only === undefined || others.length > 0
          ? { kind: "none" as const }
          : { kind: "one" as const, url: only.browser_download_url };
      };
      const zip = asset((name) => name.endsWith(".zip"));
      const icon = asset((name) => name === "icon.svg");
      if (zip.kind === "none" || icon.kind === "none") {
        skipped.push({
          tag: release.tag_name,
          reason: `${release.tag_name} needs exactly one zip and one icon.svg`,
        });
        continue;
      }
      const packageUrl = zip.url;
      const download = await fetch(packageUrl);
      if (!download.ok) {
        throw new Error(`${packageUrl}: HTTP ${String(download.status)}`);
      }
      releases.push({
        tag: release.tag_name,
        packageUrl,
        iconUrl: icon.url,
        packageZip: new Uint8Array(await download.arrayBuffer()),
      });
    }
    if (batch.length < RELEASES_PAGE_SIZE) return { releases, skipped };
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { tag: { type: "string" } },
});
const [command, dir, ...rest] = positionals;
if (dir === undefined || rest.length > 0) {
  console.error(USAGE);
  process.exit(2);
}
const pluginDir = resolve(dir);

switch (command) {
  case "check": {
    const context: CheckContext = {
      hubApiVersion: hubApiVersion(),
      tag:
        values.tag === undefined
          ? { kind: "none" }
          : { kind: "given", tag: values.tag },
      storesDir: join(REPO, "stores"),
    };
    const problems = checkPlugin(pluginDir, context);
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    console.log(
      problems.length === 0
        ? `${dir} passes plugin-format check.`
        : `${dir} fails plugin-format check with ${String(problems.length)} problem(s).`,
    );
    process.exit(problems.length === 0 ? 0 : 1);
    break;
  }
  case "pack": {
    const outDir = join(REPO, "out");
    mkdirSync(outDir, { recursive: true });
    const { file, sha256 } = packPlugin(pluginDir, outDir);
    console.log(`${file}\nsha256 ${sha256}`);
    break;
  }
  case "index": {
    const fetched = await pluginReleases(
      requiredEnv("GITHUB_REPOSITORY"),
      requiredEnv("GITHUB_TOKEN"),
    );
    const { index, skipped } = registryIndexFrom(fetched.releases);
    const left = [...fetched.skipped, ...skipped];
    writeFileSync(resolve(dir), index);
    for (const { tag, reason } of left) {
      // `::warning::` makes it an annotation on the GitHub Actions run, where this command runs.
      console.warn(`::warning::${tag} is left out of index.json: ${reason}`);
    }
    console.log(
      `${dir} lists ${String(fetched.releases.length - skipped.length)} release(s), leaving out ${String(left.length)}.`,
    );
    // The release this run published must not be one left out.
    if (left.some(({ tag }) => tag === values.tag)) process.exit(1);
    break;
  }
  case undefined:
  default:
    console.error(USAGE);
    process.exit(2);
}
