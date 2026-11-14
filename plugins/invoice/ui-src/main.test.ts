// The Plugin UI through the DOM and a fake window.hub, as staff and the Hub use it (§9.1).
// The key is generated here, never a real one; the sheet ID and the template are synthetic.

import "fake-indexeddb/auto";
import { installFakeHub, type FakeHub } from "@hawkeye-hub/fake-hub";
import { browse, logLines } from "@hawkeye-hub/fake-hub/hub-kit";
import type { FolderPath } from "@hawkeye-hub/hub-api";
import type { HubFolderFieldElement } from "@hawkeye-hub/hub-api/hub-kit";
import { IDBFactory } from "fake-indexeddb";
import JSZip from "jszip";
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
  // No test reaches the real Google: one that doesn't stub it is offline.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
  );
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

// --- Fill in by hand ------------------------------------------------------------------------

const FOLDER = "D:\\Invoices";
const TODAY = new Date(2026, 10, 14, 9, 30); // 14 Nov 2026, local time

/** Everything Save needs, set up through Settings. */
async function setUp(fake: FakeHub): Promise<void> {
  pick("template-file", docx(await fixtureTemplate(), "Official Receipt.docx"));
  await vi.waitFor(() => {
    expect(text("template-state")).toContain("Official Receipt.docx");
  });
  await chooseFolder(fake, FOLDER);
}

/** The Fill-in tab's field `name` (the i-th, for line items). */
function field(name: string, i = 0): HTMLInputElement | HTMLTextAreaElement {
  const found = $("fill-in").querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement
  >(`[name="${name}"]`)[i];
  if (found === undefined) throw new Error(`no field ${name} #${String(i)}`);
  return found;
}

function type(name: string, value: string, i = 0): void {
  const input = field(name, i);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function choosePayment(value: string): void {
  const radio = $("fill-in").querySelector<HTMLInputElement>(
    `[name="paymentMethod"][value="${value}"]`,
  );
  if (radio === null) throw new Error(`no payment method ${value}`);
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
}

function inFillIn(selector: string): HTMLElement {
  const found = $("fill-in").querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no ${selector} in Fill in`);
  return found;
}

const saveButton = (): HTMLButtonElement => $<HTMLButtonElement>("save");

/** Fills every required field of the Fill-in Invoice with one line item. */
function fillIn(): void {
  type("receivedFrom", "Chan Tai Man");
  type("studentName", "Chan Siu Ming, Chan Siu Fong");
  type("item-description", "Tuition, March");
  type("item-amount", "1,200.50");
  choosePayment("fps");
  type("receivedBy", "Ms Lee");
}

/** `word/document.xml` of the file `name` written to the save folder. */
async function savedXml(fake: FakeHub, name: string): Promise<string> {
  const file = fake.files.written.find(
    (f) => f.folder === FOLDER && f.name === name,
  );
  if (file === undefined) throw new Error(`${name} was not written`);
  const zip = await JSZip.loadAsync(file.bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (xml === undefined) throw new Error("no word/document.xml");
  return xml;
}

/** The text Word shows, runs joined, each paragraph on its own line. */
const shown = (xml: string): string =>
  xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&");

test("the Plugin opens on Import, and Fill in starts as a blank Invoice dated today", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);

  expect($("tab-import").getAttribute("aria-selected")).toBe("true");
  expect($("import").hidden).toBe(false);
  expect($("fill-in").hidden).toBe(true);

  $("tab-fill-in").click();
  expect($("fill-in").hidden).toBe(false);
  expect($("import").hidden).toBe(true);
  expect(field("date").value).toBe("2026-11-14");
  expect(inFillIn(".invoice-no").textContent).toBe("Assigned on Save");
  expect(field("receivedFrom").value).toBe("");
  expect(
    [
      ...$("fill-in").querySelectorAll<HTMLInputElement>(
        '[name="paymentMethod"]',
      ),
    ].map((r) => [r.value, r.checked]),
  ).toEqual([
    ["cash", false],
    ["bank-transfer", false],
    ["fps", false],
    ["cheque", false],
    ["other", false],
  ]);
  expect(field("remarks").value).toBe("");
  expect(saveButton().textContent).toBe("Save");
  expect(saveButton().disabled).toBe(true);
  vi.useRealTimers();
});

test("Save writes the filled Invoice as INV-<date>-0001.docx and resets the tab, keeping Received by", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  await setUp(fake);
  $("tab-fill-in").click();

  type("date", "2026-03-15");
  fillIn();
  inFillIn(".add-line-item").click();
  type("item-description", "Materials", 1);
  type("item-amount", "100", 1);
  choosePayment("other");
  type("paymentOtherText", "Octopus");
  type("remarks", "Paid early");
  expect(saveButton().disabled).toBe(false);
  expect(text("save-reason")).toBe("");

  saveButton().click();
  await vi.waitFor(() => {
    expect(fake.files.written.map((f) => f.name)).toEqual([
      "INV-20260315-0001.docx",
    ]);
  });
  const page = shown(await savedXml(fake, "INV-20260315-0001.docx"));
  for (const printed of [
    "invoice_no: INV-20260315-0001",
    "date: 15/03/2026",
    "received_from: Chan Tai Man",
    "student_name: Chan Siu Ming, Chan Siu Fong",
    "Tuition, March",
    "1,200.50",
    "Materials",
    "100.00",
    "total: 1,300.50",
    "amount_in_words: 港幣壹仟叁佰元伍角",
    "pay_cash: ☐",
    "pay_bank_transfer: ☐",
    "pay_fps: ☐",
    "pay_cheque: ☐",
    "pay_other: ☑",
    "pay_other_text: Octopus",
    "remarks: Paid early",
    "received_by: Ms Lee",
  ]) {
    expect(page).toContain(printed);
  }
  expect(page).not.toContain("{{");
  expect(page.indexOf("Tuition, March")).toBeLessThan(
    page.indexOf("Materials"),
  );

  await vi.waitFor(() => {
    expect(field("receivedFrom").value).toBe("");
  });
  expect(field("receivedBy").value).toBe("Ms Lee");
  expect(field("date").value).toBe("2026-11-14");
  expect(
    $("fill-in").querySelectorAll('[name="item-description"]'),
  ).toHaveLength(1);
  expect(fake.busy.state).toEqual({ kind: "idle" });
  expect($("result").hidden).toBe(false);
  expect(logLines($("result-log"))).toEqual([
    { tone: "success", text: "Saved INV-20260315-0001.docx" },
  ]);

  $("open-folder").click();
  await fake.settle();
  expect(fake.files.opened).toEqual([FOLDER]);
  $("dismiss").click();
  expect($("result").hidden).toBe(true);
  vi.useRealTimers();
});

test("Fill in takes the first free INV number for its date, past files already in the folder", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  for (const name of ["INV-20261114-0001.docx", "INV-20261114-0002.docx"])
    fake.files.written.push({ folder: FOLDER, name, bytes: new Uint8Array() });
  await open(fake);
  await setUp(fake);
  $("tab-fill-in").click();
  fillIn();
  saveButton().click();

  await vi.waitFor(() => {
    expect(logLines($("result-log"))).toEqual([
      { tone: "success", text: "Saved INV-20261114-0003.docx" },
    ]);
  });
  expect(shown(await savedXml(fake, "INV-20261114-0003.docx"))).toContain(
    "invoice_no: INV-20261114-0003",
  );
  vi.useRealTimers();
});

test("a refused write is reported with the OS's reason and the Invoice stays to retry", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  await setUp(fake);
  $("tab-fill-in").click();
  fillIn();
  fake.files.failNextWrite({
    code: "write-failed",
    folder: FOLDER,
    name: "INV-20261114-0001.docx",
    message: "The system cannot find the path specified.",
  });
  saveButton().click();

  await vi.waitFor(() => {
    expect(logLines($("result-log"))).toEqual([
      {
        tone: "danger",
        text: "Couldn't save INV-20261114-0001.docx: The system cannot find the path specified.",
      },
    ]);
  });
  expect(fake.files.written).toEqual([]);
  expect(field("receivedFrom").value).toBe("Chan Tai Man");
  expect(fake.busy.state).toEqual({ kind: "idle" });
  expect(saveButton().disabled).toBe(false);
  vi.useRealTimers();
});

test("Save is marked Busy while it writes", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  await setUp(fake);
  $("tab-fill-in").click();
  fillIn();
  saveButton().click();
  await vi.waitFor(() => {
    expect(fake.busy.state).toEqual({
      kind: "busy",
      reason: "Saving Invoices",
    });
  });
  await vi.waitFor(() => {
    expect(fake.busy.state).toEqual({ kind: "idle" });
  });
  vi.useRealTimers();
});

test("fields still to fill in are flagged and keep Save disabled, saying why", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  $("tab-fill-in").click();
  expect(text("save-reason")).toBe(
    "Import the Official Receipt template in Settings first. Choose a save folder in Settings first. Fill in the flagged fields first.",
  );
  await setUp(fake);
  expect(text("save-reason")).toBe("Fill in the flagged fields first.");

  const flag = (name: string): string =>
    inFillIn(`[data-flag="${name}"]`).textContent;
  expect(field("receivedFrom").getAttribute("aria-invalid")).toBe("true");
  expect(flag("receivedFrom")).toBe("Required.");
  expect(flag("paymentMethod")).toBe("Required.");

  fillIn();
  type("item-amount", "0");
  expect(flag("item-amount-0")).toBe(
    "Enter an amount above 0, such as 1,234.50.",
  );
  expect(saveButton().disabled).toBe(true);
  type("item-amount", "12.345");
  expect(saveButton().disabled).toBe(true);
  type("item-amount", "1234");
  expect(flag("item-amount-0")).toBe("");
  expect(field("receivedFrom").getAttribute("aria-invalid")).toBe("false");

  choosePayment("other");
  expect(flag("paymentOtherText")).toBe("Required.");
  expect(saveButton().disabled).toBe(true);
  type("paymentOtherText", "Octopus");
  expect(saveButton().disabled).toBe(false);

  inFillIn(".add-line-item").click();
  expect(flag("item-description-1")).toBe("Required.");
  expect(saveButton().disabled).toBe(true);
  vi.useRealTimers();
});

test("a date after today is warned but still saves", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  await setUp(fake);
  $("tab-fill-in").click();
  fillIn();
  type("date", "2026-12-01");
  expect(inFillIn('[data-flag="date"]').textContent).toBe(
    "This date is after today. Check it before saving.",
  );
  expect(saveButton().disabled).toBe(false);
  saveButton().click();
  await vi.waitFor(() => {
    expect(fake.files.written.map((f) => f.name)).toEqual([
      "INV-20261201-0001.docx",
    ]);
  });
  vi.useRealTimers();
});

test("Received by is remembered for the next open", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));
  $("tab-fill-in").click();
  type("receivedBy", "Ms Lee");

  vi.resetModules();
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));
  expect(field("receivedBy").value).toBe("Ms Lee");
  vi.useRealTimers();
});

test("switching tabs keeps the Fill-in work", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));
  $("tab-fill-in").click();
  type("receivedFrom", "Chan Tai Man");
  $("tab-import").click();
  expect(saveButton().textContent).toBe("Save 0 Invoices");
  $("tab-fill-in").click();
  expect(field("receivedFrom").value).toBe("Chan Tai Man");
  expect(saveButton().textContent).toBe("Save");
  vi.useRealTimers();
});

test("nothing typed into an Invoice reaches the Plugin's log", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const spies = (["log", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level),
  );
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  await setUp(fake);
  $("tab-fill-in").click();
  fillIn();
  saveButton().click();
  await vi.waitFor(() => {
    expect(fake.files.written).toHaveLength(1);
  });
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  vi.useRealTimers();
});

// --- The Preview ----------------------------------------------------------------------------

/** The Fill-in tab's page column, where the Preview renders. */
const preview = (): HTMLElement => inFillIn(".page");

test("the Preview renders the page Save would write, re-rendering as staff type", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  await setUp(fake);
  $("tab-fill-in").click();
  type("date", "2026-03-15");
  fillIn();

  await vi.waitFor(() => {
    expect(preview().textContent).toContain("received_from: Chan Tai Man");
  });
  for (const printed of [
    "invoice_no: Assigned on Save",
    "date: 15/03/2026",
    "Tuition, March",
    "1,200.50",
    "total: 1,200.50",
  ])
    expect(preview().textContent).toContain(printed);

  type("receivedFrom", "Wong Mei Ling");
  await vi.waitFor(() => {
    expect(preview().textContent).toContain("received_from: Wong Mei Ling");
  });
  expect(preview().textContent).not.toContain("Chan Tai Man");
  vi.useRealTimers();
});

test("with no template the page asks for one, and importing one renders it", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  $("tab-fill-in").click();
  fillIn();
  await vi.waitFor(() => {
    expect(preview().textContent).toBe(
      "Import the Official Receipt template in Settings to see the page here.",
    );
  });

  await setUp(fake);
  await vi.waitFor(() => {
    expect(preview().textContent).toContain("received_from: Chan Tai Man");
  });
  vi.useRealTimers();
});

/** The problems the banner above the page lists. */
const banner = (): string[] =>
  [...preview().querySelectorAll(".problems li")].map((li) => li.textContent);
/** The text highlighted on the rendered page. */
const highlighted = (): string[] =>
  [...preview().querySelectorAll("mark")].map((m) => m.textContent);

test("problems are listed above the page and highlighted on it", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  await open(fake);
  await setUp(fake);
  $("tab-fill-in").click();
  fillIn();
  type("studentName", "");
  type("item-amount", "12.345");

  await vi.waitFor(() => {
    expect(banner()).toEqual([
      "Student Name: Required.",
      "Amount (HKD), line 1: Enter an amount above 0, such as 1,234.50.",
    ]);
  });
  expect(preview().textContent).toContain("received_from: Chan Tai Man");
  expect(highlighted()).toEqual(["⚠", "⚠"]);

  type("studentName", "Chan Siu Ming");
  type("item-amount", "1,200.50");
  type("date", "2026-12-01");
  await vi.waitFor(() => {
    expect(banner()).toEqual([
      "Date: This date is after today. Check it before saving.",
    ]);
  });
  expect(highlighted()).toEqual(["01/12/2026"]);

  type("date", "2026-11-01");
  await vi.waitFor(() => {
    expect(banner()).toEqual([]);
  });
  expect(highlighted()).toEqual([]);
  vi.useRealTimers();
});

// --- Import from Cash Flow Sheet ------------------------------------------------------------

const EMAIL = "invoice@example.iam.gserviceaccount.com";
const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const der = new Uint8Array(
  await crypto.subtle.exportKey("pkcs8", keys.privateKey),
);
const base64 = btoa(String.fromCharCode(...der));
const pem = `-----BEGIN PRIVATE KEY-----\n${(base64.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;
const signingKeyJson = JSON.stringify({
  type: "service_account",
  project_id: "example",
  client_email: EMAIL,
  private_key: pem,
});

const HEADER = [
  "Item No.",
  "Datetime",
  "Revenues/Expenses",
  "Transaction ID",
  "Description",
  "Frequency",
  "Amount",
  "Status",
  "Responsible person",
  "Remark",
  "InFolder?",
  "Receipt unmatched",
];
/** One synthetic sheet row. Google leaves out trailing blank cells, so `remark` may end it. */
const row = (
  itemNo: string,
  date: string,
  kind: string,
  id: string,
  amount: string,
  remark = "",
): string[] => [
  itemNo,
  date,
  kind,
  id,
  kind === "Revenues" ? "Agent Commission" : "Office rent",
  "One-Time",
  amount,
  "Pending",
  "Bank",
  remark,
];

/** How Google answers one read: the rows (header first), an HTTP error at one step, or no network. */
type Answer =
  string[][] | { step: "token" | "values"; status: number } | "offline";

interface Google {
  reads: number;
  urls: string[];
}

/** Stubs `fetch` as Google: each read (a token request, then values.get) answers with the next of
 * `answers`, the last repeating. */
function stubGoogle(answers: Answer[]): Google {
  const google: Google = { reads: 0, urls: [] };
  let attempts = 0;
  const current = (): Answer =>
    answers[Math.min(attempts, answers.length) - 1] ?? "offline";
  const failure = (step: "token" | "values"): Promise<Response> | null => {
    const answer = current();
    if (answer === "offline")
      return Promise.reject(new TypeError("Failed to fetch"));
    if (Array.isArray(answer) || answer.step !== step) return null;
    return Promise.resolve(
      Response.json({ error: "synthetic" }, { status: answer.status }),
    );
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        attempts++;
        google.reads = attempts;
        return (
          failure("token") ??
          Promise.resolve(
            Response.json({ access_token: "ya29.test", expires_in: 3599 }),
          )
        );
      }
      google.urls.push(url);
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer ya29.test",
      );
      const failed = failure("values");
      if (failed !== null) return failed;
      return Promise.resolve(Response.json({ values: current() }));
    }),
  );
  return google;
}

/** Plugin Data with the sheet link set and `invoiced` remembered, as an earlier session left it. */
function remember(invoiced: string[]): void {
  localStorage.setItem(
    "invoice",
    JSON.stringify({
      v: 1,
      sheet: { kind: "set", id: SHEET_ID },
      folder: { kind: "none" },
      receivedBy: { kind: "none" },
      invoiced,
    }),
  );
}

/** Opens the Plugin with the key and sheet link stored, Google answering `answers`. */
async function openImport(
  answers: Answer[],
  invoiced: string[] = [],
): Promise<[FakeHub, Google]> {
  remember(invoiced);
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.secrets.stored.set("google-service-account", signingKeyJson);
  const google = stubGoogle(answers);
  await open(fake);
  await readDone(google, 1);
  return [fake, google];
}

async function readDone(google: Google, reads: number): Promise<void> {
  await vi.waitFor(() => {
    expect(google.reads).toBe(reads);
    expect($<HTMLButtonElement>("refresh").disabled).toBe(false);
  });
}

/** Each batch entry's picker button: its Invoice No. and status. */
const picker = (): string[] =>
  [...$("batch").querySelectorAll("button")].map((b) => b.textContent);

function inImport(selector: string): HTMLElement {
  const found = $("import").querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no ${selector} in Import`);
  return found;
}
// The editor's fields are inputs; a test that types into the textarea names it.
const importField = (name: string): HTMLInputElement =>
  inImport(`[name="${name}"]`) as HTMLInputElement;
function typeImport(name: string, value: string): void {
  const input = importField(name);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function chooseImportPayment(value: string): void {
  const radio = inImport(
    `[name="paymentMethod"][value="${value}"]`,
  ) as HTMLInputElement;
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
}

const SHEET = [
  HEADER,
  row(
    "1",
    "3/7/2026",
    "Revenues",
    "TXN-20260703-0001",
    "HKD$1,234.50",
    "Mrs Wong, for Wong Siu Ming, cash",
  ),
  row("2", "3/7/2026", "Expenses", "TXO-20260703-0001", "HKD$8,000.00"),
  row("3", "15/10/2026", "Revenues", "TXN-20261015-0001", "HKD$600.00"),
];

test("the sheet is read on open, and each Revenues row becomes an Invoice to fill in", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const [, google] = await openImport([SHEET]);

  expect(google.urls).toEqual([
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent("Cashflow_sheet!A6:L")}`,
  ]);
  expect(picker()).toEqual([
    "TXN-20260703-0001 · to fill in",
    "TXN-20261015-0001 · to fill in",
  ]);
  expect(inImport(".invoice-no").textContent).toBe("TXN-20260703-0001");
  expect(importField("date").value).toBe("2026-07-03");
  expect(importField("date").readOnly).toBe(true);
  expect(importField("item-amount").value).toBe("1,234.50");
  expect(importField("item-amount").readOnly).toBe(true);
  expect(importField("item-description").value).toBe("Agent Commission");
  expect(importField("item-description").readOnly).toBe(false);
  expect(text("remark")).toBe("Mrs Wong, for Wong Siu Ming, cash");
  expect(importField("remarks").value).toBe("");
  expect($("import").querySelector(".add-line-item")).toBeNull();
  vi.useRealTimers();
});

test("rows already invoiced are hidden behind a count", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  await openImport([SHEET], ["TXN-20260703-0001"]);
  expect(picker()).toEqual(["TXN-20261015-0001 · to fill in"]);
  expect(text("invoiced-count")).toBe("1 row already invoiced, not shown");
  vi.useRealTimers();
});

test("with every row invoiced, Import says nothing new and still shows the count", async () => {
  await openImport([SHEET], ["TXN-20260703-0001", "TXN-20261015-0001"]);
  expect(text("import-state")).toBe("Nothing new on the Cash Flow Sheet.");
  expect(text("invoiced-count")).toBe("2 rows already invoiced, not shown");
  expect($("batch-view").hidden).toBe(true);
});

test("with no key stored, Import points to Settings and reads nothing", async () => {
  remember([]);
  const google = stubGoogle([SHEET]);
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));
  expect(text("import-state")).toBe(
    "Add the service-account key and the Cash Flow Sheet link in Settings to read the sheet.",
  );
  expect(google.reads).toBe(0);
});

test("adding the key in Settings reads the sheet", async () => {
  remember([]);
  const google = stubGoogle([SHEET]);
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));
  pick("key-file", new File([signingKeyJson], "key.json"));
  await readDone(google, 1);
  expect(picker()).toHaveLength(2);
});

const NO_ACCESS = `The Cash Flow Sheet isn't shared with the service account. Ask the sheet's owner to share it with ${EMAIL}, then read again.`;
const KEY_REJECTED =
  "Google rejected the service-account key. Replace it in Settings.";
const UNREACHABLE =
  "Couldn't reach Google. Check the connection, then read again.";
const LAYOUT_CHANGED =
  "The Cash Flow Sheet's layout changed: its header row isn't the one this Plugin reads. Nothing was imported.";

test.each<[string, Answer, string, boolean]>([
  ["token 400", { step: "token", status: 400 }, KEY_REJECTED, false],
  ["values 401", { step: "values", status: 401 }, KEY_REJECTED, false],
  ["values 403", { step: "values", status: 403 }, NO_ACCESS, true],
  ["values 404", { step: "values", status: 404 }, NO_ACCESS, true],
  ["no network", "offline", UNREACHABLE, true],
  ["values 503", { step: "values", status: 503 }, UNREACHABLE, true],
  [
    "a renamed header",
    [
      HEADER.map((h) => (h === "Amount" ? "Amount (HKD)" : h)),
      ...SHEET.slice(1),
    ],
    LAYOUT_CHANGED,
    false,
  ],
  ["an empty range", [], LAYOUT_CHANGED, false],
])("a read answered with %s says so", async (_, answer, message, readAgain) => {
  await openImport([answer]);
  expect(text("import-state")).toBe(message);
  expect($("read-again").hidden).toBe(!readAgain);
  expect($("batch-view").hidden).toBe(true);
});

test("Read again reads the sheet once it is shared", async () => {
  const [, google] = await openImport([{ step: "values", status: 403 }, SHEET]);
  $("read-again").click();
  await readDone(google, 2);
  expect(picker()).toHaveLength(2);
  expect($("read-again").hidden).toBe(true);
});

/** Picks entry `i` in the batch picker. */
function choose(i: number): void {
  const button = $("batch").querySelectorAll("button")[i];
  if (button === undefined) throw new Error(`no entry ${String(i)}`);
  button.click();
}

test("rows the sheet must fix are blocked, naming why and the Item No.", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  await openImport([
    [
      HEADER,
      row("4", "3/7/2026", "Revenues", "TXN-2026073-0001", "HKD$100.00"),
      row("5", "3/7/2026", "Revenues", "TXN-20260704-0001", "HKD$100.00"),
      row("6", "4/7/2026", "Revenues", "TXN-20260704-0002", "HKD$100.00"),
      row("7", "4/7/2026", "Revenues", "TXN-20260704-0002", "HKD$200.00"),
      row("8", "5/7/2026", "Revenues", "TXN-20260705-0001", "HKD$0.00"),
      row("9", "5/7/2026", "Revenues", "TXN-20260705-0002", "1,000"),
      row("10", "31/2/2026", "Revenues", "TXN-20260231-0001", "HKD$100.00"),
      row("11", "5/7/2026", "Revenues", "TXN-20260705-0003", "HKD$100.00"),
    ],
  ]);
  expect(picker()).toEqual([
    "TXN-2026073-0001 · blocked: fix on sheet",
    "TXN-20260704-0001 · blocked: fix on sheet",
    "TXN-20260704-0002 · blocked: fix on sheet",
    "TXN-20260704-0002 · blocked: fix on sheet",
    "TXN-20260705-0001 · blocked: fix on sheet",
    "TXN-20260705-0002 · blocked: fix on sheet",
    "TXN-20260231-0001 · blocked: fix on sheet",
    "TXN-20260705-0003 · to fill in",
  ]);
  const banner = (i: number): string => {
    choose(i);
    return text("blocked");
  };
  expect(banner(0)).toBe(
    "Transaction ID invalid. Item No. 4: fix it on the Cash Flow Sheet and import again.",
  );
  expect(banner(1)).toBe(
    "Transaction ID invalid. Item No. 5: fix it on the Cash Flow Sheet and import again.",
  );
  expect(banner(2)).toBe(
    "Transaction ID used on rows 6 and 7. Item No. 6: fix it on the Cash Flow Sheet and import again.",
  );
  expect(banner(3)).toBe(
    "Transaction ID used on rows 6 and 7. Item No. 7: fix it on the Cash Flow Sheet and import again.",
  );
  expect(banner(4)).toBe(
    "Amount can't be read or isn't above 0. Item No. 8: fix it on the Cash Flow Sheet and import again.",
  );
  expect(banner(5)).toBe(
    "Amount can't be read or isn't above 0. Item No. 9: fix it on the Cash Flow Sheet and import again.",
  );
  expect(banner(6)).toBe(
    "Date can't be read. Item No. 10: fix it on the Cash Flow Sheet and import again.",
  );
  expect(banner(7)).toBe("");
  vi.useRealTimers();
});

/** Fills what the sheet doesn't hold for the Import tab's current Invoice. */
function fillImport(): void {
  typeImport("receivedFrom", "Mrs Wong");
  typeImport("studentName", "Wong Siu Ming");
  chooseImportPayment("cash");
  typeImport("receivedBy", "Ms Lee");
}

test("a filled-in Invoice turns ready, a future-dated one warned, and Save counts both", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  await openImport([
    [
      HEADER,
      row("1", "3/7/2026", "Revenues", "TXN-20260703-0001", "HKD$1,234.50"),
      row("2", "1/12/2026", "Revenues", "TXN-20261201-0001", "HKD$600.00"),
    ],
  ]);
  expect(saveButton().textContent).toBe("Save 0 Invoices");
  expect(importField("receivedFrom").getAttribute("aria-invalid")).toBe("true");

  fillImport();
  expect(picker()[0]).toBe("TXN-20260703-0001 · ready");
  expect(saveButton().textContent).toBe("Save 1 Invoice");

  choose(1);
  // Received by is remembered from the first Invoice.
  expect(importField("receivedBy").value).toBe("Ms Lee");
  typeImport("receivedFrom", "Mr Chan");
  typeImport("studentName", "Chan Siu Fong");
  chooseImportPayment("fps");
  expect(picker()[1]).toBe("TXN-20261201-0001 · warned");
  expect(inImport('[data-flag="date"]').textContent).toBe(
    "This date is after today. Check it before saving.",
  );
  expect(saveButton().textContent).toBe("Save 2 Invoices");

  // Each entry keeps what was typed into it.
  choose(0);
  expect(importField("receivedFrom").value).toBe("Mrs Wong");
  vi.useRealTimers();
});

test("Skip leaves an Invoice out of the count, and Next steps through the batch", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  await openImport([SHEET]);
  fillImport();
  expect(saveButton().textContent).toBe("Save 1 Invoice");

  $("skip").click();
  expect(picker()[0]).toBe("TXN-20260703-0001 · skipped");
  expect(saveButton().textContent).toBe("Save 0 Invoices");
  expect(text("skip")).toBe("Don't skip");
  $("skip").click();
  expect(picker()[0]).toBe("TXN-20260703-0001 · ready");

  $("next").click();
  expect(inImport(".invoice-no").textContent).toBe("TXN-20261015-0001");
  expect(text("remark")).toBe("");
  expect($<HTMLButtonElement>("next").disabled).toBe(true);
  vi.useRealTimers();
});

test("Save N Invoices writes every ready one, carries on past failures, and remembers what was saved", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const sheet = [
    HEADER,
    row("1", "1/7/2026", "Revenues", "TXN-20260701-0001", "HKD$100.00"),
    row("2", "2/7/2026", "Revenues", "TXN-20260702-0001", "HKD$200.00"),
    row("3", "3/7/2026", "Revenues", "TXN-20260703-0001", "HKD$300.00"),
    row("4", "4/7/2026", "Revenues", "TXN-20260704-0001", "HKD$400.00"),
  ];
  const [fake] = await openImport([sheet]);
  // Saved from another machine already.
  fake.files.written.push({
    folder: FOLDER,
    name: "TXN-20260702-0001.docx",
    bytes: new Uint8Array(),
  });
  await setUp(fake);
  for (const i of [0, 1, 2]) {
    choose(i);
    fillImport();
  }
  expect(saveButton().textContent).toBe("Save 3 Invoices");
  expect(saveButton().disabled).toBe(false);
  fake.files.failNextWrite({
    code: "write-failed",
    folder: FOLDER,
    name: "TXN-20260701-0001.docx",
    message: "Access is denied.",
  });

  saveButton().click();
  await vi.waitFor(() => {
    expect(logLines($("result-log"))).toEqual([
      {
        tone: "danger",
        text: "Couldn't save TXN-20260701-0001.docx: Access is denied.",
      },
      { tone: "info", text: "Already saved TXN-20260702-0001.docx" },
      { tone: "success", text: "Saved TXN-20260703-0001.docx" },
    ]);
  });
  expect(shown(await savedXml(fake, "TXN-20260703-0001.docx"))).toContain(
    "invoice_no: TXN-20260703-0001",
  );
  expect(fake.busy.state).toEqual({ kind: "idle" });
  expect($("result").hidden).toBe(false);
  // The failed one stays to retry, with what was typed; the saved ones leave the list.
  expect(picker()).toEqual([
    "TXN-20260701-0001 · ready",
    "TXN-20260704-0001 · to fill in",
  ]);
  expect(saveButton().textContent).toBe("Save 1 Invoice");
  expect(JSON.parse(localStorage.getItem("invoice") ?? "{}")).toMatchObject({
    invoiced: ["TXN-20260702-0001", "TXN-20260703-0001"],
  });
  vi.useRealTimers();
});

test("Refresh reads again at once with nothing typed, and asks first when edits would be lost", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const later = [
    ...SHEET,
    row("4", "16/10/2026", "Revenues", "TXN-20261016-0001", "HKD$50.00"),
  ];
  const [, google] = await openImport([SHEET, SHEET, later]);
  $("refresh").click();
  await readDone(google, 2);
  expect($("refresh-confirm").hidden).toBe(true);

  typeImport("receivedFrom", "Mrs Wong");
  $("refresh").click();
  expect($("refresh-confirm").hidden).toBe(false);
  $("refresh-cancel").click();
  expect($("refresh-confirm").hidden).toBe(true);
  expect(google.reads).toBe(2);
  expect(importField("receivedFrom").value).toBe("Mrs Wong");

  $("refresh").click();
  $("refresh-discard").click();
  await readDone(google, 3);
  expect(picker()).toHaveLength(3);
  expect(importField("receivedFrom").value).toBe("");
  vi.useRealTimers();
});

test("no sheet row or typed name reaches the Plugin's log", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const spies = (["log", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level),
  );
  const [, google] = await openImport([SHEET, { step: "values", status: 403 }]);
  fillImport();
  $("skip").click();
  $("refresh").click();
  $("refresh-discard").click();
  await readDone(google, 2);
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  vi.useRealTimers();
});

test("a full import and save logs nothing but Invoice Nos.", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  const spies = (["log", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level),
  );
  const [fake] = await openImport([SHEET]);
  await setUp(fake);
  fillImport();
  saveButton().click();
  await vi.waitFor(() => {
    expect(fake.files.written).toHaveLength(1);
  });
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  const logged = JSON.stringify(logLines($("result-log")));
  expect(logged).toContain("TXN-20260703-0001");
  for (const secret of [
    "Mrs Wong",
    "Wong Siu Ming",
    "1,234.50",
    "Agent Commission",
    "{{",
    "PRIVATE KEY",
    SHEET_ID,
  ])
    expect(logged).not.toContain(secret);
  vi.useRealTimers();
});

test("the Import tab previews its Invoice under its Transaction ID", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  await openImport([SHEET]);
  const importPage = (): string => inImport(".page").textContent;
  await vi.waitFor(() => {
    expect(importPage()).toBe(
      "Import the Official Receipt template in Settings to see the page here.",
    );
  });

  pick("template-file", docx(await fixtureTemplate()));
  fillImport();
  await vi.waitFor(() => {
    expect(importPage()).toContain("invoice_no: TXN-20260703-0001");
  });
  expect(importPage()).toContain("received_from: Mrs Wong");
  expect(importPage()).toContain("total: 1,234.50");
  vi.useRealTimers();
});
