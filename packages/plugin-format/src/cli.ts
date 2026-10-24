// `pnpm plugin-format check|pack <dir>` (PLUGIN_STANDARD.md §10) and `index <file>` (ADR 0011).
// Node runs this file directly with type stripping, so local imports name their `.ts` file.
//   check <dir> [--tag plugin/<id>@<version>]   prints every problem, exits 1 if there are any
//   pack <dir>                                  writes out/<id>-<version>.zip, prints its sha256
//   index <file>                                writes the Registry's index.json from every
//                                               Plugin release of $GITHUB_REPOSITORY
// pnpm runs root scripts in the repo root, so `<dir>` is relative to it (`plugins/<id>`).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import semver from "semver";
import { z } from "zod";
import { checkPlugin, type CheckContext } from "./check.ts";
import { packPlugin } from "./pack.ts";
import { registryIndexFrom, type PluginRelease } from "./registry-index.ts";

const REPO = join(import.meta.dirname, "../../..");
const USAGE =
  "usage: plugin-format check <dir> [--tag plugin/<id>@<version>]\n       plugin-format pack <dir>\n       plugin-format index <file>";

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

/** Every published `plugin/*` release of `repo`, with its Plugin Package downloaded. */
async function pluginReleases(
  repo: string,
  token: string,
): Promise<PluginRelease[]> {
  const releases: PluginRelease[] = [];
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
      const asset = (name: string, matches: (name: string) => boolean) => {
        const [only, ...others] = release.assets.filter((a) => matches(a.name));
        if (only === undefined || others.length > 0) {
          throw new Error(`${release.tag_name} needs exactly one ${name}`);
        }
        return only.browser_download_url;
      };
      const packageUrl = asset("zip", (name) => name.endsWith(".zip"));
      const download = await fetch(packageUrl);
      if (!download.ok) {
        throw new Error(`${packageUrl}: HTTP ${String(download.status)}`);
      }
      releases.push({
        tag: release.tag_name,
        packageUrl,
        iconUrl: asset("icon.svg", (name) => name === "icon.svg"),
        packageZip: new Uint8Array(await download.arrayBuffer()),
      });
    }
    if (batch.length < RELEASES_PAGE_SIZE) return releases;
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
    const releases = await pluginReleases(
      requiredEnv("GITHUB_REPOSITORY"),
      requiredEnv("GITHUB_TOKEN"),
    );
    writeFileSync(resolve(dir), registryIndexFrom(releases));
    console.log(`${dir} lists ${String(releases.length)} release(s).`);
    break;
  }
  case undefined:
  default:
    console.error(USAGE);
    process.exit(2);
}
