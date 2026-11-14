import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { writeNewFile } from "./files";

// files.ts also serves the folder dialog and the shell; this tests only the write.
vi.mock("electron", () => ({}));

const folder = () => mkdtempSync(join(tmpdir(), "hub-files-"));
const bytes = new TextEncoder().encode("receipt");

test("writes a new file and leaves only it in the folder", async () => {
  const dir = folder();
  await expect(writeNewFile(dir, "INV-1.docx", bytes)).resolves.toEqual({
    kind: "done",
    value: undefined,
  });
  expect(readFileSync(join(dir, "INV-1.docx"), "utf8")).toBe("receipt");
  expect(readdirSync(dir)).toEqual(["INV-1.docx"]);
});

test("refuses with exists and leaves the existing file untouched", async () => {
  const dir = folder();
  writeFileSync(join(dir, "INV-1.docx"), "first");
  await expect(writeNewFile(dir, "INV-1.docx", bytes)).resolves.toEqual({
    kind: "refused",
    refusal: { code: "exists", folder: dir, name: "INV-1.docx" },
  });
  expect(readFileSync(join(dir, "INV-1.docx"), "utf8")).toBe("first");
});

test("two writes racing for one name: exactly one wins", async () => {
  const dir = folder();
  const answers = await Promise.all([
    writeNewFile(dir, "INV-1.docx", new TextEncoder().encode("a")),
    writeNewFile(dir, "INV-1.docx", new TextEncoder().encode("b")),
  ]);
  expect(answers.map((a) => a.kind).sort()).toEqual(["done", "refused"]);
  expect(readdirSync(dir)).toEqual(["INV-1.docx"]);
});

test("a missing folder is not created: write-failed with the OS's message", async () => {
  const dir = join(folder(), "gone");
  const answer = await writeNewFile(dir, "INV-1.docx", bytes);
  expect(answer).toMatchObject({
    kind: "refused",
    refusal: { code: "write-failed", folder: dir, name: "INV-1.docx" },
  });
  expect(
    answer.kind === "refused" &&
      "message" in answer.refusal &&
      answer.refusal.message,
  ).toMatch(/ENOENT/);
});
