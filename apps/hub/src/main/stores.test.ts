import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { StoreChange } from "@hawkeye-hub/hub-api";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StoreName } from "@hawkeye-hub/plugin-format";
import { beforeEach, expect, test, vi } from "vitest";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import { createStores, StoreRefused } from "./stores";

let dataDir: AbsolutePath;

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-stores-")));
});

const kb = StoreName.parse("kb");

/** How long a stopped watch is given to report anything, which it must not. */
const WATCH_QUIET_MS = 300;

test("a file one Plugin UI writes is read by another, and by a Backend from the store's folder", async () => {
  const writer = createStores(dataDir, [kb]);
  const reader = createStores(dataDir, [kb]);

  await writer.writeText("kb", "notes/2026/a.md", "# A");

  expect(await reader.readText("kb", "notes/2026/a.md")).toBe("# A");
  expect(
    readFileSync(
      join(dataDir, "stores", "kb", "notes", "2026", "a.md"),
      "utf8",
    ),
  ).toBe("# A");
});

test("bytes round-trip unchanged", async () => {
  const stores = createStores(dataDir, [kb]);
  const bytes = new Uint8Array([0, 255, 13, 10, 128]);

  await stores.writeBytes("kb", "scan.bin", bytes);

  expect(await stores.readBytes("kb", "scan.bin")).toEqual(bytes);
});

test("a declared store is empty until written, and lists every file in it, a Backend's too, as POSIX paths", async () => {
  const stores = createStores(dataDir, [kb]);
  expect(await stores.list("kb")).toEqual([]);

  await stores.writeText("kb", "notes/2026/a.md", "a");
  await stores.writeText("kb", "b.md", "b");
  mkdirSync(join(dataDir, "stores", "kb", "empty"));
  writeFileSync(join(dataDir, "stores", "kb", "notes", "c.md"), "c");

  expect([...(await stores.list("kb"))].sort()).toEqual([
    "b.md",
    "notes/2026/a.md",
    "notes/c.md",
  ]);
});

test("reading a file the store does not have is refused with not-found", async () => {
  const stores = createStores(dataDir, [kb]);

  await expect(stores.readText("kb", "missing.md")).rejects.toEqual(
    new StoreRefused({ code: "not-found", store: "kb", path: "missing.md" }),
  );
  await expect(stores.readBytes("kb", "missing.md")).rejects.toEqual(
    new StoreRefused({ code: "not-found", store: "kb", path: "missing.md" }),
  );
});

test("watch reports what another Plugin and a Backend change, and stops when asked", async () => {
  const watcher = createStores(dataDir, [kb]);
  const other = createStores(dataDir, [kb]);
  const changes: StoreChange[] = [];
  const stop = watcher.watch("kb", (change) => changes.push(change));

  await other.writeText("kb", "notes/a.md", "a");
  await vi.waitFor(() => {
    expect(changes).toContainEqual({ path: "notes/a.md", kind: "changed" });
  });
  writeFileSync(join(dataDir, "stores", "kb", "b.md"), "b");
  await vi.waitFor(() => {
    expect(changes).toContainEqual({ path: "b.md", kind: "changed" });
  });
  rmSync(join(dataDir, "stores", "kb", "b.md"));
  await vi.waitFor(() => {
    expect(changes).toContainEqual({ path: "b.md", kind: "removed" });
  });
  // A write's temp file and the folders it makes are never reported.
  expect(
    changes.every(({ path }) => path === "notes/a.md" || path === "b.md"),
  ).toBe(true);

  stop();
  const seen = changes.length;
  await other.writeText("kb", "c.md", "c");
  await new Promise((resolve) => setTimeout(resolve, WATCH_QUIET_MS));
  expect(changes).toHaveLength(seen);
});

// Only Windows names no file on overflow; Linux's recursive watch is emulated in JS and takes
// far longer than the test timeout to take in the burst.
test.runIf(process.platform === "win32")(
  "a burst of changes too big for the OS to name one by one leaves the watch running",
  async () => {
    const stores = createStores(dataDir, [kb]);
    const changes: StoreChange[] = [];
    const stop = stores.watch("kb", (change) => changes.push(change));

    // Synchronously, so the watch cannot drain them: on Windows they overflow its buffer, and the
    // watch hears of a change with no file name.
    for (let i = 0; i < 2000; i++) {
      writeFileSync(
        join(
          dataDir,
          "stores",
          "kb",
          `a-long-name-to-fill-the-buffer-${String(i)}.md`,
        ),
        "x",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, WATCH_QUIET_MS));
    await stores.writeText("kb", "after.md", "a");

    await vi.waitFor(() => {
      expect(changes).toContainEqual({ path: "after.md", kind: "changed" });
    });
    stop();
  },
);

test("watching a store not in the Manifest's stores is refused with store-not-declared", () => {
  const stores = createStores(dataDir, [kb]);

  expect(() => stores.watch("receipts", () => undefined)).toThrow(
    new StoreRefused({ code: "store-not-declared", store: "receipts" }),
  );
});

test("a write replaces the file atomically: a new file is renamed over it, and no temp file is left", async () => {
  const stores = createStores(dataDir, [kb]);
  const file = join(dataDir, "stores", "kb", "a.md");
  await stores.writeText("kb", "a.md", "old");
  const before = statSync(file, { bigint: true }).ino;

  await stores.writeText("kb", "a.md", "new");

  // Rewritten in place, the file would keep its identity; replaced, it is another file.
  expect(statSync(file, { bigint: true }).ino).not.toBe(before);
  expect(readFileSync(file, "utf8")).toBe("new");
  expect(readdirSync(join(dataDir, "stores", "kb"))).toEqual(["a.md"]);
});

test("a store not in the Manifest's stores is refused with store-not-declared, and nothing is written", async () => {
  const stores = createStores(dataDir, [kb]);
  const refused = new StoreRefused({
    code: "store-not-declared",
    store: "receipts",
  });

  await expect(stores.writeText("receipts", "a.json", "{}")).rejects.toEqual(
    refused,
  );
  await expect(stores.readText("receipts", "a.json")).rejects.toEqual(refused);
  expect(existsSync(join(dataDir, "stores", "receipts"))).toBe(false);
});

test.each([
  ["a parent segment", "../escape.md"],
  ["a parent segment inside", "notes/../../escape.md"],
  ["a POSIX absolute path", "/etc/passwd"],
  ["a Windows absolute path", "C:/Windows/win.ini"],
  ["a Windows separator", "notes\\a.md"],
  ["a current-folder segment", "./a.md"],
  ["an empty segment", "notes//a.md"],
  ["a trailing slash", "notes/"],
  ["the empty path", ""],
  ["a name a write's temp file could have", ".a.md.hub-tmp"],
])("%s is refused with bad-path, and nothing is written", async (_, path) => {
  const stores = createStores(dataDir, [kb]);
  const refused = new StoreRefused({ code: "bad-path", path });

  await expect(stores.writeText("kb", path, "x")).rejects.toEqual(refused);
  await expect(stores.readText("kb", path)).rejects.toEqual(refused);
  expect(existsSync(join(dataDir, "escape.md"))).toBe(false);
  expect(existsSync(join(dataDir, "stores", "escape.md"))).toBe(false);
});
