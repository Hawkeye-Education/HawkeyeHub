// What differs between Windows and macOS for a Backend process (ADR 0003): where its venv's Python
// is, how it is spawned, and how its whole process tree is killed. Everything else is the same.

import { execFile, spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const WINDOWS = process.platform === "win32";

/** The venv's Python, as install builds it. */
export function venvPython(backendDir: string): string {
  return WINDOWS
    ? join(backendDir, ".venv", "Scripts", "python.exe")
    : join(backendDir, ".venv", "bin", "python");
}

/**
 * Whether a Backend is spawned detached: on macOS, so it leads its own process group and the
 * whole tree can be killed. Not on Windows, where detached opens a console; taskkill /T walks the
 * tree there instead.
 */
export const SPAWN_DETACHED = !WINDOWS;

/** A running process, as Windows lists it: `created` tells a process from an earlier one with its id. */
export interface ProcessEntry {
  pid: number;
  parent: number;
  created: bigint;
}

/**
 * The process tree rooted at `root`: it and every process descended from it. Windows never
 * re-parents an orphan, so a process whose parent id names a tree member but is older than it is
 * the orphan of an earlier process that had that id, and is not in the tree.
 */
export function treeOf(
  root: number,
  processes: readonly ProcessEntry[],
): ProcessEntry[] {
  const rootEntry = processes.find(({ pid }) => pid === root);
  if (rootEntry === undefined) return [];
  const tree = [rootEntry];
  for (const parent of tree) {
    for (const each of processes) {
      if (each.parent === parent.pid && each.created >= parent.created) {
        tree.push(each);
      }
    }
  }
  return tree;
}

// One line per process: id, parent id, creation time. The System Idle Process has no creation time.
const LIST_PROCESSES = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  'Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.ToFileTimeUtc())" }',
];
const PROCESS_LINE = /^(\d+) (\d+) (\d+)$/;

async function windowsProcesses(): Promise<ProcessEntry[]> {
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    LIST_PROCESSES,
    {
      windowsHide: true,
    },
  );
  return stdout
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .map((line) => {
      const [, pid, parent, created] = PROCESS_LINE.exec(line) ?? [];
      if (pid === undefined || parent === undefined || created === undefined) {
        throw new Error(`Not a process line: ${JSON.stringify(line)}`);
      }
      return {
        pid: Number(pid),
        parent: Number(parent),
        created: BigInt(created),
      };
    });
}

// taskkill reports a process already gone by its exit code, which is not needed here.
const TASKKILL_OPTIONS = { stdio: "ignore", windowsHide: true } as const;
function taskkillArgs(pids: readonly number[]): string[] {
  return [...pids.flatMap((pid) => ["/pid", String(pid)]), "/T", "/F"];
}

/** Kills macOS process group `pid` now. A group already gone has nothing left to kill. */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

export interface ProcessTree {
  /**
   * Notes the tree's processes while its root still runs. On Windows taskkill /T only finds a tree
   * through live parents, and the venv's python.exe is a launcher whose child is the real
   * interpreter, so once the root exits its leftover children can only be found from this note.
   */
  remember(): Promise<void>;
  /** Kills every remembered process still running, with any tree below it. Resolves once done. */
  kill(): Promise<void>;
}

/** The process tree of Backend `pid`. */
export function processTree(pid: number): ProcessTree {
  if (!WINDOWS) {
    // The process group outlives its leader, so it needs no note.
    return {
      remember: () => Promise.resolve(),
      kill: () => {
        killGroup(pid);
        return Promise.resolve();
      },
    };
  }
  let remembered: ProcessEntry[] = [];
  return {
    async remember() {
      remembered = treeOf(pid, await windowsProcesses());
    },
    async kill() {
      // Only processes that are still the same ones: an id may have been reused since.
      // ponytail: a process the Backend launched after `remember` is missed once the Backend has
      // exited; remember again as it launches one if a Plugin ever relies on that.
      const running = await windowsProcesses();
      const alive = remembered.filter((noted) =>
        running.some(
          (each) => each.pid === noted.pid && each.created === noted.created,
        ),
      );
      if (alive.length === 0) return;
      await new Promise<void>((resolve) => {
        spawn(
          "taskkill",
          taskkillArgs(alive.map((each) => each.pid)),
          TASKKILL_OPTIONS,
        ).once("exit", () => {
          resolve();
        });
      });
    },
  };
}

/**
 * Kills the tree of Backend `pid` synchronously, for a Hub that is about to exit: taskkill /T on
 * Windows, which walks the live tree, and the process group on macOS.
 */
export function killTreeNow(pid: number): void {
  if (WINDOWS) {
    spawnSync("taskkill", taskkillArgs([pid]), TASKKILL_OPTIONS);
    return;
  }
  killGroup(pid);
}
