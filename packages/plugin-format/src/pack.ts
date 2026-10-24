// `plugin-format pack` (ADR 0005, PLUGIN_STANDARD.md §10): the platform-neutral Plugin Package zip.
// It holds `manifest.json`, `icon.svg`, `ui/`, `agents/` and `backend/`, without the venv, tests or
// tool caches, and never wheels: the Hub builds the venv from `uv.lock` on each machine.

import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { zipSync } from "fflate";
import { readManifest } from "./check.ts";

const PACKED = ["manifest.json", "icon.svg", "ui", "agents", "backend"];

/** Folders never packed, at any depth: the venv, the tests, and Python tools' caches. */
function isExcluded(name: string): boolean {
  return (
    name === ".venv" ||
    name === "tests" ||
    name === "__pycache__" ||
    name.endsWith("_cache")
  );
}

export interface Packed {
  file: string;
  sha256: string;
}

/** Writes the Plugin in `dir` to `<outDir>/<id>-<version>.zip`. Run `checkPlugin` first. */
export function packPlugin(dir: string, outDir: string): Packed {
  const read = readManifest(dir);
  if (read.kind === "unreadable") {
    throw new Error(read.problem);
  }
  const files: Record<string, Uint8Array> = {};
  for (const top of PACKED.filter((path) => existsSync(join(dir, path)))) {
    for (const path of filesUnder(dir, top)) {
      files[path] = readFileSync(join(dir, path));
    }
  }
  const zip = zipSync(files);
  const { id, version } = read.manifest;
  const file = join(outDir, `${id}-${version}.zip`);
  writeFileSync(file, zip);
  return { file, sha256: createHash("sha256").update(zip).digest("hex") };
}

/** The POSIX paths, relative to `dir`, of every file at or under `path`, skipping excluded folders. */
function filesUnder(dir: string, path: string): string[] {
  const full = join(dir, path);
  if (!statSync(full).isDirectory()) {
    return [relative(dir, full).split(sep).join("/")];
  }
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => !(entry.isDirectory() && isExcluded(entry.name)))
    .flatMap((entry) => filesUnder(dir, join(path, entry.name)));
}
