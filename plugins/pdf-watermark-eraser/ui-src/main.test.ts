// The Plugin UI through the DOM and a fake window.hub, as staff and the Hub use it (§9.1).

import {
  backendError,
  installFakeHub,
  type FakeHub,
} from "@hawkeye-hub/fake-hub";
import type { HubFolderFieldElement } from "@hawkeye-hub/hub-api/hub-kit";
import { beforeEach, expect, test, vi } from "vitest";
import manifest from "../manifest.json";
import { browse, logLines } from "./hub-kit-double";
import page from "./index.html?raw";

// The page's body only: happy-dom would fetch the head's stylesheet and script.
const html = page.slice(
  page.indexOf("<body>") + "<body>".length,
  page.indexOf("</body>"),
);
const IN = "C:\\pdfs";
const OUT = "C:\\clean";

// The test names the element type it knows index.html gives that id.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no #${id}`);
  return el as T;
};
const text = (id: string): string => $(id).textContent;
const click = (id: string): void => {
  $(id).click();
};

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

/** Opens the Plugin UI against a fresh fake Hub. */
async function open(displayLanguage = "en-HK"): Promise<FakeHub> {
  const fake = installFakeHub({ manifest, displayLanguage });
  fake.backend.handle("listPdfs", () => ({ files: ["a.pdf", "sub/b.pdf"] }));
  document.body.innerHTML = html;
  await import("./main");
  return fake;
}

/** Picks both folders with the Hub's dialog and types a pattern. */
async function fillIn(fake: FakeHub, pattern = "dse\\.life"): Promise<void> {
  fake.files.queuePick({ kind: "chosen", path: IN });
  browse($<HubFolderFieldElement>("input"));
  fake.files.queuePick({ kind: "chosen", path: OUT });
  browse($<HubFolderFieldElement>("output"));
  await fake.settle();
  const input = $<HTMLInputElement>("pattern");
  input.value = pattern;
  input.dispatchEvent(new Event("change"));
  $<HTMLInputElement>("regex").click();
}

test("a run erases into the output folder, logging each file, while Busy", async () => {
  const fake = await open();
  await fillIn(fake);
  const busyDuringRun: unknown[] = [];
  fake.backend.handle("run", () => {
    busyDuringRun.push(fake.busy.state);
    fake.backend.emit("progress", {
      done: 1,
      total: 2,
      file: "a.pdf",
      result: { kind: "cleaned", removed: 2 },
    });
    fake.backend.emit("progress", {
      done: 2,
      total: 2,
      file: "sub/b.pdf",
      result: { kind: "no-match" },
    });
    return { cleaned: 1, failed: 1, total: 2, cancelled: false };
  });

  click("run");
  await fake.settle();

  expect(fake.backend.requests.at(-1)).toEqual({
    method: "run",
    params: {
      input: IN,
      output: OUT,
      pattern: "dse\\.life",
      regex: true,
      ignoreCase: true,
    },
  });
  expect(busyDuringRun).toEqual([
    {
      kind: "busy",
      reason: "Removing watermarks. Closing now stops the run part-way.",
    },
  ]);
  expect(fake.busy.state).toEqual({ kind: "idle" });
  expect(logLines($("log"))).toEqual([
    { tone: "success", text: "OK    a.pdf: removed 2 objects" },
    {
      tone: "danger",
      text: "FAIL  sub/b.pdf: no matching watermark text found",
    },
  ]);
  expect(text("summary")).toBe("Done: 1 cleaned, 1 failed, 2 total.");
  expect($<HTMLProgressElement>("progress").value).toBe(1);

  click("open-output");
  await fake.settle();
  expect(fake.files.opened).toEqual([OUT]);
});

test("Cancel tells the Backend to stop, and the summary says how far it got", async () => {
  const fake = await open();
  await fillIn(fake);
  const finish = Promise.withResolvers<unknown>();
  fake.backend.handle("run", () => {
    fake.backend.emit("progress", {
      done: 1,
      total: 5,
      file: "a.pdf",
      result: { kind: "cleaned", removed: 1 },
    });
    return finish.promise;
  });

  click("run");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect($("cancel").hidden).toBe(false);
  expect(fake.busy.state.kind).toBe("busy");
  click("cancel");
  expect(fake.backend.notifications).toEqual([
    { method: "cancel", params: {} },
  ]);
  finish.resolve({ cleaned: 1, failed: 0, total: 5, cancelled: true });
  await fake.settle();

  expect(text("summary")).toBe("Cancelled after 1 of 5 files.");
  expect($("cancel").hidden).toBe(true);
  expect(fake.busy.state).toEqual({ kind: "idle" });
});

test.each([
  ["pattern-empty", "Watermark text is empty."],
  ["pattern-invalid", "That regex is not valid: missing )"],
  ["same-folder", "Input and output folders must differ."],
  [
    "output-inside-input",
    "The output folder must not be inside the input folder.",
  ],
  ["folder-missing", "That folder no longer exists."],
  ["password", "That PDF is password protected."],
  ["already-running", "A run is already in progress."],
  ["invalid-params", "The eraser was asked something it cannot do: missing )"],
  ["method-not-found", "This version of the eraser cannot do that: missing )"],
  ["internal", "Something went wrong: missing )"],
])("a run rejected with %s says why and clears Busy", async (reason, words) => {
  const fake = await open();
  await fillIn(fake);
  fake.backend.handle("run", () => {
    // A HubError is a plain object by contract (hub-api), so this throws no Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw backendError(reason, "missing )");
  });

  click("run");
  await fake.settle();

  expect(text("summary")).toBe(words);
  expect(fake.busy.state).toEqual({ kind: "idle" });
  expect($<HTMLButtonElement>("run").disabled).toBe(false);
});

test("the Plugin UI reads in the Display Language", async () => {
  const fake = await open("zh-HK");
  await fillIn(fake);
  fake.backend.handle("run", () => {
    // A HubError is a plain object by contract (hub-api), so this throws no Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw backendError("same-folder", "input and output are the same folder");
  });

  click("run");
  await fake.settle();

  expect(text("run")).toBe("移除水印");
  expect(text("summary")).toBe("輸入及輸出資料夾必須不同。");
});

test("an unknown Display Language falls back to English, and a run needs both folders", async () => {
  const fake = await open("fr-FR");

  click("run");
  await fake.settle();

  expect(text("summary")).toBe("Choose an input and an output folder first.");
  expect(fake.backend.requests).toEqual([]);
});

test("Show text shows a page's text and its repeated lines, and Copy copies it", async () => {
  const fake = await open();
  fake.backend.handle("pageText", () => ({
    lines: ["Quarterly report", "Provided by dse.life"],
    repeated: ["Provided by dse.life"],
  }));
  await fillIn(fake);
  expect([...$<HTMLSelectElement>("file").options].map((o) => o.value)).toEqual(
    ["a.pdf", "sub/b.pdf"],
  );
  $<HTMLSelectElement>("file").value = "sub/b.pdf";
  $<HTMLInputElement>("page").value = "2";

  click("show");
  await fake.settle();

  expect(fake.backend.requests.at(-1)).toEqual({
    method: "pageText",
    params: { folder: IN, file: "sub/b.pdf", page: 1 },
  });
  expect(text("text")).toBe("Quarterly report\nProvided by dse.life");
  expect(text("repeated")).toBe("Repeats on most pages: Provided by dse.life");

  click("copy");
  await fake.settle();
  await expect(navigator.clipboard.readText()).resolves.toBe(
    "Quarterly report\nProvided by dse.life",
  );
});

test("an input folder with no PDFs says so, and Show text stays off", async () => {
  const fake = await open();
  fake.backend.handle("listPdfs", () => ({ files: [] }));

  fake.files.queuePick({ kind: "chosen", path: IN });
  browse($<HubFolderFieldElement>("input"));
  await fake.settle();

  expect(text("file")).toBe("No PDFs in this folder");
  expect($<HTMLButtonElement>("show").disabled).toBe(true);
});

test("the next open restores the folders and pattern, and lists the input folder", async () => {
  const first = await open();
  await fillIn(first, "Confidential");

  vi.resetModules();
  const fake = await open();
  await fake.settle();

  expect($<HubFolderFieldElement>("input").value).toEqual({
    kind: "chosen",
    path: IN,
  });
  expect($<HubFolderFieldElement>("output").value).toEqual({
    kind: "chosen",
    path: OUT,
  });
  expect($<HTMLInputElement>("pattern").value).toBe("Confidential");
  expect($<HTMLInputElement>("regex").checked).toBe(true);
  expect($<HTMLInputElement>("ignore-case").checked).toBe(true);
  expect(fake.backend.requests).toEqual([
    { method: "listPdfs", params: { folder: IN } },
  ]);
});

test("corrupt Plugin Data fails the open rather than being guessed at", async () => {
  localStorage.setItem("settings", JSON.stringify({ v: 1, input: "C:\\pdfs" }));

  await expect(open()).rejects.toThrow();
});

test("an output folder the OS cannot open says why", async () => {
  const fake = await open();
  fake.files.failNextOpen({
    code: "folder-not-opened",
    path: OUT,
    message: "Access denied",
  });
  await fillIn(fake);
  fake.backend.handle("run", () => ({
    cleaned: 1,
    failed: 0,
    total: 1,
    cancelled: false,
  }));
  click("run");
  await fake.settle();

  click("open-output");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(text("summary")).toBe("The folder could not be opened: Access denied");
});
