// The Plugin UI through the DOM and a fake window.hub, as staff and the Hub use it (§9.1).
// The key is generated here, never a real one; the sheet ID and the template are synthetic.

import "fake-indexeddb/auto";
import { installFakeHub, type FakeHub } from "@hawkeye-hub/fake-hub";
import { browse } from "@hawkeye-hub/fake-hub/hub-kit";
import type { FolderPath } from "@hawkeye-hub/hub-api";
import type { HubFolderFieldElement } from "@hawkeye-hub/hub-api/hub-kit";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, test, vi } from "vitest";
import manifest from "../manifest.json";
import { fixtureTemplate } from "./fixture-template";
import page from "./index.html?raw";
import { PLACEHOLDERS } from "./template";

// The page's body only: happy-dom would fetch the head's stylesheet and script.
const html = page.slice(
  page.indexOf("<body>") + "<body>".length,
  page.indexOf("</body>"),
);

// The test names the element type it knows index.html gives that id.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no #${id}`);
  return el as T;
};
const text = (id: string): string => $(id).textContent;

beforeEach(() => {
  localStorage.clear();
  indexedDB = new IDBFactory(); // a fresh, empty template store per test
  vi.resetModules();
});

/** Opens the Plugin UI against `fake`. */
async function open(fake: FakeHub): Promise<void> {
  document.body.innerHTML = html;
  await import("./main");
  await fake.settle();
}

test("the first open opens Settings and names everything missing", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "zh-HK" });
  await open(fake);

  expect($<HTMLDetailsElement>("settings").open).toBe(true);
  expect(text("settings-summary")).toBe(
    "Settings: still needed: service-account key, Cash Flow Sheet link, Official Receipt template, save folder",
  );
});

// --- Helpers that act as staff do ------------------------------------------------------------

/** Picks `file` with the file input `id`. */
function pick(id: string, file: File): void {
  const input = $<HTMLInputElement>(id);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

function pasteLink(link: string): void {
  const input = $<HTMLInputElement>("sheet-link");
  input.value = link;
  input.dispatchEvent(new Event("change"));
}

async function chooseFolder(fake: FakeHub, path: string): Promise<void> {
  fake.files.queuePick({ kind: "chosen", path: path as FolderPath });
  browse($<HubFolderFieldElement>("folder"));
  await fake.settle();
}

const docx = (bytes: Uint8Array<ArrayBuffer>, name = "receipt.docx"): File =>
  new File([bytes], name);

// Only the shape matters to Settings; the sheet read signs with a generated key (a later ticket).
const KEY_JSON = JSON.stringify({
  type: "service_account",
  project_id: "example",
  client_email: "invoice@example.iam.gserviceaccount.com",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nnot a real key\n-----END PRIVATE KEY-----\n",
});
const SHEET_ID = "1SyntheticSheetId_for-tests";
const LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;

// --- The key --------------------------------------------------------------------------------

test("importing a service-account key stores it as the Plugin Secret", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);

  pick("key-file", new File([KEY_JSON], "key.json"));
  await vi.waitFor(() => {
    expect(fake.secrets.stored.get("google-service-account")).toBe(KEY_JSON);
  });
  expect(text("settings-summary")).not.toContain("service-account key");
});

test("a file that isn't a key is refused, and a stored key is kept", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.secrets.stored.set("google-service-account", KEY_JSON);
  await open(fake);

  pick("key-file", new File(['{"hello": 1}'], "notes.json"));
  await vi.waitFor(() => {
    expect(text("key-error")).toContain("isn't a Google service-account key");
  });
  expect(fake.secrets.stored.get("google-service-account")).toBe(KEY_JSON);
});

// --- The Cash Flow Sheet link ---------------------------------------------------------------

test("a pasted Sheets link is kept as the sheet ID across opens", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  pasteLink(LINK);
  expect(text("settings-summary")).not.toContain("Cash Flow Sheet link");

  vi.resetModules();
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));
  expect($<HTMLInputElement>("sheet-link").value).toContain(SHEET_ID);
  expect(text("settings-summary")).not.toContain("Cash Flow Sheet link");
});

test("a link that isn't a Google Sheet is refused and the previous one kept", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  pasteLink(LINK);
  for (const bad of [
    "https://docs.google.com/document/d/abc/edit",
    "https://example.com/spreadsheets/d/abc",
    "not a link",
  ]) {
    pasteLink(bad);
    expect(text("sheet-error")).toContain("isn't a Google Sheets link");
  }

  vi.resetModules();
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));
  expect($<HTMLInputElement>("sheet-link").value).toContain(SHEET_ID);
});

// --- The template ---------------------------------------------------------------------------

test("a template with every placeholder is imported and kept across opens", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  pick("template-file", docx(await fixtureTemplate(), "Official Receipt.docx"));
  await vi.waitFor(() => {
    expect(text("template-state")).toContain("Official Receipt.docx");
  });

  vi.resetModules();
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));
  expect(text("template-state")).toContain("Official Receipt.docx");
  expect(text("settings-summary")).not.toContain("template");
});

test("a template missing or adding placeholders is refused by name, keeping the previous one", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  pick("template-file", docx(await fixtureTemplate(), "good.docx"));
  await vi.waitFor(() => {
    expect(text("template-state")).toContain("good.docx");
  });

  const names = PLACEHOLDERS.filter(
    (n) => n !== "total" && n !== "item_amount",
  );
  pick(
    "template-file",
    docx(await fixtureTemplate([...names, "totl"]), "bad.docx"),
  );
  await vi.waitFor(() => {
    expect(text("template-error")).toBe(
      "Missing placeholders: {{item_amount}}, {{total}}. Unknown placeholders: {{totl}}. The previous template is kept.",
    );
  });
  expect(text("template-state")).toContain("good.docx");

  // One stray placeholder is enough to refuse, with every required one present.
  pick(
    "template-file",
    docx(await fixtureTemplate([...PLACEHOLDERS, "student"]), "typo.docx"),
  );
  await vi.waitFor(() => {
    expect(text("template-error")).toBe(
      "Unknown placeholders: {{student}}. The previous template is kept.",
    );
  });
  expect(text("template-state")).toContain("good.docx");

  vi.resetModules();
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));
  expect(text("template-state")).toContain("good.docx");
});

test("a file that isn't a .docx is refused", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  pick("template-file", new File(["just text"], "receipt.docx"));
  await vi.waitFor(() => {
    expect(text("template-error")).toContain("isn't a Word .docx");
  });
  expect(text("settings-summary")).toContain("Official Receipt template");
});

// --- The save folder and the whole strip ----------------------------------------------------

test("once everything is set, Settings collapses to one line and stays so on reopen", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  pick("key-file", new File([KEY_JSON], "key.json"));
  pasteLink(LINK);
  pick("template-file", docx(await fixtureTemplate(), "Official Receipt.docx"));
  await vi.waitFor(() => {
    expect(text("template-state")).toContain("Official Receipt.docx");
  });
  expect($<HTMLDetailsElement>("settings").open).toBe(true);

  await chooseFolder(fake, "D:\\Invoices");
  expect($<HTMLDetailsElement>("settings").open).toBe(false);
  expect(text("settings-summary")).toBe(
    "Settings: template Official Receipt.docx, saving to D:\\Invoices",
  );

  vi.resetModules();
  const again = installFakeHub({ manifest, displayLanguage: "en-HK" });
  again.secrets.stored.set("google-service-account", KEY_JSON);
  await open(again);
  expect($<HTMLDetailsElement>("settings").open).toBe(false);
  expect($<HubFolderFieldElement>("folder").value).toEqual({
    kind: "chosen",
    path: "D:\\Invoices",
  });
});

test("nothing staff set up reaches the Plugin's log", async () => {
  const spies = (["log", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level),
  );
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  pick("key-file", new File([KEY_JSON], "key.json"));
  pasteLink(LINK);
  pick("template-file", docx(await fixtureTemplate()));
  await vi.waitFor(() => {
    expect(text("template-state")).toContain("receipt.docx");
  });
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
