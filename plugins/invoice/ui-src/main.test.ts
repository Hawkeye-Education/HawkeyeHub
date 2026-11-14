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
