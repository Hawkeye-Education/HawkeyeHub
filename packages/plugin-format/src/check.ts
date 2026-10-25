// `plugin-format check` (PLUGIN_STANDARD.md §10): everything about a Plugin's folder that would make
// its release fail, found before it is tagged. It reports every problem it finds, not the first.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { parseManifest, type Manifest, type PythonMinor } from "./manifest.ts";

export interface CheckContext {
  /** The Hub API version the Plugin's `hubApi` range must admit: `@hawkeye-hub/hub-api`'s. */
  hubApiVersion: string;
  /** The release tag being published; `none` when checking before tagging. */
  tag: { kind: "none" } | { kind: "given"; tag: string };
  /** The repo's `stores/` folder, holding a `<name>.md` per Shared Store (§6). */
  storesDir: string;
}

// PLUGIN_STANDARD.md §2's fixed paths. `ui/index.html` is what the Hub loads (plugin-views.ts), and
// the Hub reads `agents/skills/` whole (assistant-context.ts).
const ALWAYS = ["icon.svg", "ui/index.html"];
const BACKEND = [
  "backend/pyproject.toml",
  "backend/uv.lock",
  "backend/main.py",
];
const ASSISTANT = ["agents/assistant.md", "agents/skills"];

/** Every problem with the Plugin in `dir`, one sentence each; empty when it may be released. */
export function checkPlugin(dir: string, context: CheckContext): string[] {
  const missing = (paths: string[]): string[] =>
    paths
      .filter((path) => !existsSync(join(dir, path)))
      .map((path) => `${path} is missing.`);
  const problems = missing(ALWAYS);

  const manifest = readManifest(dir);
  if (manifest.kind === "unreadable") {
    return [...problems, manifest.problem];
  }
  const { id, version, hubApi, stores, backend, assistant } = manifest.manifest;

  if (!semver.satisfies(context.hubApiVersion, hubApi)) {
    problems.push(
      `hubApi "${hubApi}" is not satisfied by Hub API ${context.hubApiVersion}, so no Hub could open this Plugin.`,
    );
  }
  switch (context.tag.kind) {
    case "given": {
      const expected = `plugin/${id}@${version}`;
      if (context.tag.tag !== expected) {
        problems.push(
          `The tag ${context.tag.tag} disagrees with the Manifest, which needs ${expected}.`,
        );
      }
      break;
    }
    case "none":
      break;
    default:
      context.tag satisfies never;
  }
  for (const store of stores) {
    if (!existsSync(join(context.storesDir, `${store}.md`))) {
      problems.push(
        `The Manifest declares the store ${store}, but stores/${store}.md is missing.`,
      );
    }
  }

  switch (backend.kind) {
    case "python": {
      const absent = missing(BACKEND);
      problems.push(...absent);
      if (
        !absent.some((problem) => problem.startsWith("backend/pyproject.toml"))
      ) {
        problems.push(...checkPyproject(dir, version, backend.python));
      }
      if (!absent.some((problem) => problem.startsWith("backend/uv.lock"))) {
        problems.push(...checkLock(dir));
      }
      break;
    }
    case "none":
      if (existsSync(join(dir, "backend"))) {
        problems.push(
          "backend/ is present, but the Manifest declares no Backend.",
        );
      }
      break;
    default:
      backend satisfies never;
  }
  switch (assistant.kind) {
    case "enabled": {
      const absent = missing(ASSISTANT);
      problems.push(...absent);
      if (absent.length === 0) {
        problems.push(...checkSkills(join(dir, "agents/skills")));
      }
      break;
    }
    case "none":
      if (existsSync(join(dir, "agents"))) {
        problems.push(
          "agents/ is present, but the Manifest enables no Assistant.",
        );
      }
      break;
    default:
      assistant satisfies never;
  }
  return problems;
}

// skills-ref, the Agent Skills reference validator, from PyPI through uvx (its command is
// `agentskills`). Pinned so a new release cannot fail a Plugin that passed yesterday.
const SKILLS_REF = ["--from", "skills-ref==0.1.1", "agentskills", "validate"];

function checkSkills(skillsDir: string): string[] {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const result = spawnSync(
        "uvx",
        [...SKILLS_REF, join(skillsDir, entry.name)],
        {
          encoding: "utf8",
        },
      );
      if (result.error !== undefined) {
        throw new Error(
          `skills-ref validate needs uv's uvx: ${result.error.message}`,
        );
      }
      return result.status === 0
        ? []
        : [
            `agents/skills/${entry.name} fails skills-ref validate:\n${result.stdout}${result.stderr}`,
          ];
    });
}

// The fields of `backend/pyproject.toml` the Manifest must agree with; uv reads the rest.
const Pyproject = z.object({
  project: z.object({ version: z.string(), "requires-python": z.string() }),
});

function checkPyproject(
  dir: string,
  version: string,
  python: PythonMinor,
): string[] {
  let toml: unknown;
  try {
    toml = parseToml(readFileSync(join(dir, "backend/pyproject.toml"), "utf8"));
  } catch (error) {
    // smol-toml throws TomlError on malformed input, which is the problem to report.
    return [`backend/pyproject.toml is not TOML: ${String(error)}`];
  }
  const parsed = Pyproject.safeParse(toml);
  if (!parsed.success) {
    return [
      `backend/pyproject.toml needs [project] version and requires-python:\n${z.prettifyError(parsed.error)}`,
    ];
  }
  const { version: pyVersion, "requires-python": requiresPython } =
    parsed.data.project;
  const problems: string[] = [];
  if (pyVersion !== version) {
    problems.push(
      `backend/pyproject.toml's version ${pyVersion} disagrees with the Manifest's ${version}.`,
    );
  }
  const range = semverRangeOf(requiresPython);
  const lowest = range === null ? null : semver.minVersion(range);
  if (
    lowest === null ||
    `${String(lowest.major)}.${String(lowest.minor)}` !== python
  ) {
    problems.push(
      `requires-python "${requiresPython}" disagrees with backend.python ${python}: its lowest Python must be ${python}.`,
    );
  }
  return problems;
}

// The sources `uv sync --frozen` can install from on a staff machine, which has no repo and no git:
// a package index, a URL, and the Backend itself (`virtual`, as `package = false` locks it).
const PORTABLE_SOURCES = ["registry", "url", "virtual"];

const Lock = z.object({
  package: z.array(
    z.object({ name: z.string(), source: z.record(z.string(), z.unknown()) }),
  ),
});

function checkLock(dir: string): string[] {
  let toml: unknown;
  try {
    toml = parseToml(readFileSync(join(dir, "backend/uv.lock"), "utf8"));
  } catch (error) {
    // smol-toml throws TomlError on malformed input, which is the problem to report.
    return [`backend/uv.lock is not TOML: ${String(error)}`];
  }
  const parsed = Lock.safeParse(toml);
  if (!parsed.success) {
    return [
      `backend/uv.lock needs its [[package]] entries:\n${z.prettifyError(parsed.error)}`,
    ];
  }
  return parsed.data.package
    .filter(({ source }) =>
      Object.keys(source).some((kind) => !PORTABLE_SOURCES.includes(kind)),
    )
    .map(
      ({ name, source }) =>
        `backend/uv.lock installs ${name} from ${JSON.stringify(source)}, which a staff machine has no copy of: lock it from a package index.`,
    );
}

const PEP440_CLAUSE = /^(~=|==|<=|>=|<|>)\s*(\d+(?:\.\d+){0,2})(\.\*)?$/;

/**
 * A PEP 440 specifier set as a semver range, or `null` for one this does not translate (`!=`,
 * `===`, pre-releases, more than three release parts). Plugins pin a plain floor, so it need not.
 */
function semverRangeOf(specifiers: string): string | null {
  const clauses: string[] = [];
  for (const clause of specifiers.split(",")) {
    const match = PEP440_CLAUSE.exec(clause.trim());
    if (match === null) {
      return null;
    }
    const [, operator, release, wildcard] = match;
    if (operator === undefined || release === undefined) {
      return null;
    }
    const parts = release.split(".").map(Number);
    const padded = [0, 1, 2].map((index) => parts[index] ?? 0).join(".");
    if (wildcard !== undefined) {
      if (operator !== "==") {
        return null;
      }
      clauses.push(`${release}.x`);
    } else if (operator === "~=") {
      // ~=X.Y means >=X.Y, ==X.*; ~=X.Y.Z means >=X.Y.Z, ==X.Y.*.
      if (parts.length < 2) {
        return null;
      }
      clauses.push(`>=${padded} ${parts.slice(0, -1).join(".")}.x`);
    } else {
      clauses.push(`${operator === "==" ? "" : operator}${padded}`);
    }
  }
  return semver.validRange(clauses.join(" "));
}

type ManifestRead =
  | { kind: "read"; manifest: Manifest }
  | { kind: "unreadable"; problem: string };

export function readManifest(dir: string): ManifestRead {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) {
    return { kind: "unreadable", problem: "manifest.json is missing." };
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // JSON.parse throws only SyntaxError, which is the problem to report.
    return {
      kind: "unreadable",
      problem: `manifest.json is not JSON: ${String(error)}`,
    };
  }
  const parsed = parseManifest(json);
  return parsed.kind === "valid"
    ? { kind: "read", manifest: parsed.manifest }
    : {
        kind: "unreadable",
        problem: `manifest.json fails the schema:\n${parsed.reason}`,
      };
}
