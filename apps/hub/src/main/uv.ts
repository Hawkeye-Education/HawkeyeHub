// uv, on demand (ADRs 0005, 0011). The Hub keeps uv, the interpreters it installs and its cache in
// one `uv` folder in the Hub's data folder, and runs it only through `Uv`, the seam tests replace.
// A Hub with no Python-Backend Plugin carries none of it: the folder goes with the last one.

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import type { HostPlatform, RegistryFetch } from "./registry";

/** The uv the Hub downloads. CODING_STANDARDS' `required-version` follows it. */
export const UV_VERSION = "0.13.5";

// Astral's release assets for UV_VERSION, with the sha256 its own `.sha256` assets publish.
const UV_RELEASES: Record<
  "win32-x64" | "darwin-arm64",
  { asset: string; sha256: string; binary: string }
> = {
  "win32-x64": {
    asset: "uv-x86_64-pc-windows-msvc.zip",
    sha256: "a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a",
    binary: "uv.exe",
  },
  "darwin-arm64": {
    asset: "uv-aarch64-apple-darwin.tar.gz",
    sha256: "743f85035a1996ecb350659e01cd9faea9709829be09b1b4b03c73eaf3c9cd73",
    binary: "uv",
  },
};

/** How long uv's download may take before it counts as failed. */
const UV_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** How one uv run ended. `stderr` is all of it; the caller keeps what it needs. */
export type UvRun = { kind: "succeeded" } | { kind: "failed"; stderr: string };

export interface Uv {
  /** Runs uv with `args` in `cwd`, downloading uv first if the Hub has none. */
  run(args: readonly string[], cwd: AbsolutePath): Promise<UvRun>;
}

/** Everything uv: uv itself, its interpreters (`python/`) and its cache (`cache/`). */
export function uvFolder(dataDir: AbsolutePath): AbsolutePath {
  return parseAbsolutePath(join(dataDir, "uv"));
}

/** Where uv installs interpreters: `UV_PYTHON_INSTALL_DIR`. */
export function interpretersFolder(dataDir: AbsolutePath): string {
  return join(uvFolder(dataDir), "python");
}

/**
 * The Hub's uv. Each run gets uv's cache and interpreters under `uvFolder`, never reads a uv
 * config file, uses only uv's own Pythons, and drops staff's own `UV_*` variables, so neither
 * staff's Python nor their uv setup is used. uv is downloaded on the first run and checked against
 * its pinned sha256.
 */
export function createUv({
  dataDir,
  fetch,
  platform,
}: {
  dataDir: AbsolutePath;
  fetch: RegistryFetch;
  platform: HostPlatform;
}): Uv {
  const folder = uvFolder(dataDir);
  const release =
    platform === "win32-x64" || platform === "darwin-arm64"
      ? UV_RELEASES[platform]
      : null;
  const binDir = join(folder, `uv-${UV_VERSION}`);
  return {
    async run(args, cwd) {
      if (release === null) {
        throw new Error(`No uv is pinned for ${platform}`);
      }
      const binary = join(binDir, release.binary);
      if (!existsSync(binary)) {
        const downloaded = await downloadUv(fetch, release, binDir);
        if (downloaded.kind === "failed") return downloaded;
      }
      const env: NodeJS.ProcessEnv = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) =>
            !key.toUpperCase().startsWith("UV_") &&
            key.toUpperCase() !== "VIRTUAL_ENV",
        ),
      );
      Object.assign(env, {
        UV_CACHE_DIR: join(folder, "cache"),
        UV_PYTHON_INSTALL_DIR: interpretersFolder(dataDir),
        UV_NO_CONFIG: "1",
        UV_PYTHON_PREFERENCE: "only-managed",
        NO_COLOR: "1",
      });
      return new Promise((resolve) => {
        const child = spawn(binary, args, {
          cwd,
          env,
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        });
        let stderr = "";
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.once("error", (error) => {
          resolve({ kind: "failed", stderr: `${stderr}${error.message}` });
        });
        child.once("close", (code) => {
          resolve(
            code === 0 ? { kind: "succeeded" } : { kind: "failed", stderr },
          );
        });
      });
    },
  };
}

/**
 * Downloads `release`, checks it, and unpacks its uv into `binDir`, through `binDir.partial` so a
 * cut-short download never looks like uv. Other uv versions, from an earlier Hub, go.
 */
async function downloadUv(
  fetch: RegistryFetch,
  release: (typeof UV_RELEASES)[keyof typeof UV_RELEASES],
  binDir: string,
): Promise<{ kind: "downloaded" } | { kind: "failed"; stderr: string }> {
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${release.asset}`;
  let bytes: Uint8Array;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(UV_DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        kind: "failed",
        stderr: `Downloading uv ${UV_VERSION} answered HTTP ${String(response.status)}`,
      };
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    // Not swallowed: a failed download is this run's failure, which the build reports.
    return {
      kind: "failed",
      stderr: `Downloading uv ${UV_VERSION} failed: ${String(error)}`,
    };
  }
  if (createHash("sha256").update(bytes).digest("hex") !== release.sha256) {
    return {
      kind: "failed",
      stderr: `uv ${UV_VERSION}'s download does not match its sha256`,
    };
  }
  // Every uv here is another version, or a leftover of this one: none has the binary.
  const folder = dirname(binDir);
  mkdirSync(folder, { recursive: true });
  for (const entry of readdirSync(folder)) {
    if (entry.startsWith("uv-")) {
      rmSync(join(folder, entry), { recursive: true, force: true });
    }
  }
  const partial = `${binDir}.partial`;
  mkdirSync(partial);
  if (release.asset.endsWith(".zip")) {
    // Windows: uv.exe sits at the zip's root.
    const files = unzipSync(bytes, {
      filter: (file) => file.name === release.binary,
    });
    const binary = files[release.binary];
    if (binary === undefined) {
      throw new Error(`${release.asset} holds no ${release.binary}`);
    }
    writeFileSync(join(partial, release.binary), binary);
  } else {
    // macOS: the system tar, which keeps uv's executable bit; uv sits in one top folder.
    const archive = join(partial, release.asset);
    writeFileSync(archive, bytes);
    await promisify(execFile)("tar", [
      "-xzf",
      archive,
      "-C",
      partial,
      "--strip-components",
      "1",
    ]);
    rmSync(archive);
  }
  renameSync(partial, binDir);
  return { kind: "downloaded" };
}

const HOME_LINE = /^home\s*=\s*(.+?)\s*$/m;

/**
 * After a Python-Backend Plugin's venv went (uninstall, or a failed build): with no venv left, the
 * whole uv folder goes. Otherwise each interpreter no remaining `.venv/pyvenv.cfg` refers to is
 * uninstalled, then uv's cache is pruned. A venv waiting in an unswapped update's folder counts.
 * A uv run that fails throws: nothing staff could act on.
 */
export async function pruneUv(uv: Uv, dataDir: AbsolutePath): Promise<void> {
  const folder = uvFolder(dataDir);
  if (!existsSync(folder)) return;
  // Every `<id>@<version>` folder's venv, recorded or not. Jobs run one at a time, so no
  // `.partial` folder is building now.
  const homes = readdirSync(dataDir, { withFileTypes: true }).flatMap(
    (entry) => {
      const cfg = join(dataDir, entry.name, "backend", ".venv", "pyvenv.cfg");
      if (
        !entry.isDirectory() ||
        !entry.name.includes("@") ||
        !existsSync(cfg)
      ) {
        return [];
      }
      const home = HOME_LINE.exec(readFileSync(cfg, "utf8"))?.[1];
      // A venv whose interpreter is gone holds nothing to keep.
      return home !== undefined && existsSync(home) ? [realpathSync(home)] : [];
    },
  );
  if (homes.length === 0) {
    rmSync(folder, { recursive: true, force: true });
    return;
  }
  const interpreters = interpretersFolder(dataDir);
  // Each install is a real folder; uv's minor-version links (junctions on Windows) and its
  // dot-files are not interpreters of their own.
  const unused = existsSync(interpreters)
    ? readdirSync(interpreters, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .filter((key) => {
          const dir = realpathSync(join(interpreters, key));
          return !homes.some(
            (home) => home === dir || home.startsWith(dir + sep),
          );
        })
        .sort()
    : [];
  if (unused.length > 0) {
    await mustRun(uv, ["python", "uninstall", ...unused], dataDir);
  }
  await mustRun(uv, ["cache", "prune"], dataDir);
}

async function mustRun(
  uv: Uv,
  args: readonly string[],
  cwd: AbsolutePath,
): Promise<void> {
  const run = await uv.run(args, cwd);
  if (run.kind === "failed") {
    throw new Error(`uv ${args.join(" ")} failed: ${run.stderr}`);
  }
}
