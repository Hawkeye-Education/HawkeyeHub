// `pnpm plugin-format check|pack <dir>` (PLUGIN_STANDARD.md §10). Node runs this file directly with
// type stripping, so local imports name their `.ts` file.
//   check <dir> [--tag plugin/<id>@<version>]   prints every problem, exits 1 if there are any
//   pack <dir>                                  writes out/<id>-<version>.zip, prints its sha256
// pnpm runs root scripts in the repo root, so `<dir>` is relative to it (`plugins/<id>`).

import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import semver from "semver";
import { checkPlugin, type CheckContext } from "./check.ts";
import { packPlugin } from "./pack.ts";

const REPO = join(import.meta.dirname, "../../..");
const USAGE =
  "usage: plugin-format check <dir> [--tag plugin/<id>@<version>]\n       plugin-format pack <dir>";

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
  case undefined:
  default:
    console.error(USAGE);
    process.exit(2);
}
