// Invoice's Plugin UI: plain DOM over native elements and the Hub Kit. This is the Settings strip:
// the key, the Cash Flow Sheet link, the Official Receipt template and the save folder. It opens
// itself naming what's missing, and collapses to one line once all are set. Nothing here logs.

import type { FolderPath, HubError } from "@hawkeye-hub/hub-api";
import {
  KEY_SECRET,
  parseCashFlow,
  parseKey,
  parseSheetLink,
  readSheet,
  SheetReadFailed,
  sheetLink,
  type KeyParse,
  type ReadFailure,
} from "./google";
import { t } from "./i18n";
import { loadPluginData, savePluginData, type PluginData } from "./plugin-data";
import { checkTemplate, loadTemplate, saveTemplate } from "./template";
import { createEditor } from "./editor";
import {
  blankDraft,
  today,
  type InvoiceDraft,
  type InvoiceNo,
} from "./invoice";
import {
  importEntry,
  review,
  reviewBatch,
  type BlockReason,
  type EntryStatus,
  type ImportEntry,
} from "./review";
import { fileName, saveFillIn, writeInvoice } from "./save";

/** The element `<tag id=id>`, which index.html always has. */
function byId<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  id: string,
): HTMLElementTagNameMap[K] {
  const found = [...document.getElementsByTagName(tag)].find(
    (el) => el.id === id,
  );
  if (found === undefined)
    throw new Error(`index.html has no <${tag} id=${id}>`);
  return found;
}

const hub = window.hub;
const settings = byId("details", "settings");
const summary = byId("summary", "settings-summary");
const keyFile = byId("input", "key-file");
const keyState = byId("span", "key-state");
const keyError = byId("span", "key-error");
const sheetInput = byId("input", "sheet-link");
const sheetError = byId("span", "sheet-error");
const templateFile = byId("input", "template-file");
const templateState = byId("span", "template-state");
const templateError = byId("span", "template-error");
const folder = byId("hub-folder-field", "folder");

byId("span", "key-label").textContent = t("key.label");
byId("span", "sheet-label").textContent = t("sheet.label");
byId("span", "template-label").textContent = t("template.label");
folder.label = t("folder");

let data: PluginData = loadPluginData();
function update(next: PluginData): void {
  data = next;
  savePluginData(data);
  show();
}

const stored = await hub.secrets.get(KEY_SECRET);
// The stored text passed parseKey before it was saved; parsed again here, at the boundary.
let key: KeyParse =
  stored.kind === "stored" ? parseKey(stored.value) : { kind: "invalid" };
let keyStored = key.kind === "valid";
let template = await loadTemplate();

// --- The tabs and Save -----------------------------------------------------------------------

const tabs = {
  import: {
    tab: byId("button", "tab-import"),
    panel: byId("section", "import"),
  },
  "fill-in": {
    tab: byId("button", "tab-fill-in"),
    panel: byId("section", "fill-in"),
  },
};
type Tab = keyof typeof tabs;
let active: Tab = "import";
const saveButton = byId("button", "save");
const saveReason = byId("span", "save-reason");
const result = byId("section", "result");
const resultLog = byId("hub-log", "result-log");
const openFolderButton = byId("button", "open-folder");
tabs.import.tab.textContent = t("tab.import");
tabs["fill-in"].tab.textContent = t("tab.fillIn");
openFolderButton.textContent = t("result.openFolder");
byId("button", "dismiss").textContent = t("result.dismiss");

const rememberedName = (): string =>
  data.receivedBy.kind === "set" ? data.receivedBy.name : "";
/** Remembers a newly typed Received by for later Invoices, then refreshes Save. */
function edited(draft: InvoiceDraft): void {
  const name = draft.receivedBy.trim();
  if (name !== "" && name !== rememberedName())
    update({ ...data, receivedBy: { kind: "set", name } });
  else showSave();
}
let fillDraft = blankDraft(today(), rememberedName());
const fillEditor = createEditor("none", template, (draft) => {
  fillDraft = draft;
  edited(draft);
});
tabs["fill-in"].panel.append(fillEditor.element);
fillEditor.load(fillDraft, t("editor.assignedOnSave"));

// --- Import from Cash Flow Sheet --------------------------------------------------------------

/**
 * The Import tab. `batch.entries` is the batch in sheet order; Save (#207) writes each entry
 * `reviewBatch` calls ready or warned, then drops the written ones and records them as invoiced.
 */
type ImportState =
  | { readonly kind: "setup" }
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly failure: ReadFailure | "layoutChanged" }
  | { readonly kind: "batch"; readonly batch: Batch };
interface Batch {
  entries: ImportEntry[];
  /** Rows not shown because their Transaction ID is already invoiced. */
  readonly hidden: number;
  /** The entry in the editor. */
  current: number;
  /** Whether staff typed or skipped anything since the read, so Refresh asks first. */
  edited: boolean;
}
let importState: ImportState = { kind: "setup" };

const refreshButton = byId("button", "refresh");
const readAgainButton = byId("button", "read-again");
const invoicedCount = byId("span", "invoiced-count");
const refreshConfirm = byId("div", "refresh-confirm");
const importStatus = byId("p", "import-state");
const batchView = byId("div", "batch-view");
const batchPicker = byId("div", "batch");
const skipButton = byId("button", "skip");
const nextButton = byId("button", "next");
const blockedText = byId("p", "blocked");
const remark = byId("span", "remark");
refreshButton.textContent = t("import.refresh");
readAgainButton.textContent = t("import.readAgain");
byId("span", "refresh-confirm-text").textContent = t("import.confirm");
byId("button", "refresh-discard").textContent = t("import.discard");
byId("button", "refresh-cancel").textContent = t("import.cancel");
nextButton.textContent = t("import.next");
byId("span", "remark-label").textContent = t("import.remark");

const importEditor = createEditor("sheet-values", template, (draft) => {
  if (importState.kind !== "batch")
    throw new Error("the Import editor changed with no batch");
  const { batch } = importState;
  batch.entries[batch.current] = { ...entryAt(batch), draft };
  batch.edited = true;
  edited(draft);
});
batchView.append(importEditor.element);

function entryAt(batch: Batch): ImportEntry {
  const entry = batch.entries[batch.current];
  if (entry === undefined) throw new Error("the current entry is gone");
  return entry;
}

/** Reads the sheet into a fresh batch, replacing the last one. */
async function read(): Promise<void> {
  if (key.kind === "invalid" || data.sheet.kind === "none") {
    importState = { kind: "setup" };
    showImport();
    return;
  }
  const signer = key.key;
  importState = { kind: "reading" };
  showImport();
  let grid: string[][];
  try {
    grid = await readSheet(signer, data.sheet.id);
  } catch (e) {
    if (!(e instanceof SheetReadFailed)) throw e;
    importState = { kind: "failed", failure: e.failure };
    showImport();
    return;
  }
  const sheet = parseCashFlow(grid);
  if (sheet.kind === "layoutChanged") {
    importState = { kind: "failed", failure: "layoutChanged" };
    showImport();
    return;
  }
  const invoiced = new Set<string>(data.invoiced);
  const fresh = sheet.rows.filter((r) => !invoiced.has(r.transactionId));
  importState = {
    kind: "batch",
    batch: {
      entries: fresh.map((r) => importEntry(r, rememberedName())),
      hidden: sheet.rows.length - fresh.length,
      current: 0,
      edited: false,
    },
  };
  showImport();
  loadCurrent();
}

/** Puts the current entry in the editor. */
function loadCurrent(): void {
  if (importState.kind !== "batch") return;
  const { batch } = importState;
  if (batch.entries.length === 0) return;
  let entry = entryAt(batch);
  // A name typed into an earlier entry since the read: staff type their own name once.
  if (entry.draft.receivedBy === "") {
    entry = {
      ...entry,
      draft: { ...entry.draft, receivedBy: rememberedName() },
    };
    batch.entries[batch.current] = entry;
  }
  importEditor.load(entry.draft, entry.sourceRow.transactionId);
  showSave();
}

/** The Import tab for `importState`: its message, the batch and the current entry's status. */
function showImport(): void {
  refreshConfirm.hidden = true;
  refreshButton.disabled = importState.kind === "reading";
  readAgainButton.hidden = true;
  invoicedCount.textContent = "";
  batchView.hidden = true;
  switch (importState.kind) {
    case "setup":
      importStatus.textContent = t("import.setup");
      break;
    case "reading":
      importStatus.textContent = t("import.reading");
      break;
    case "failed": {
      const { failure } = importState;
      importStatus.textContent =
        failure === "noAccess" && key.kind === "valid"
          ? t("import.noAccess", { email: key.key.client_email })
          : t(`import.${failure}`);
      readAgainButton.hidden =
        failure !== "noAccess" && failure !== "unreachable";
      break;
    }
    case "batch": {
      const { batch } = importState;
      if (batch.hidden > 0)
        invoicedCount.textContent = t("import.invoiced", {
          count: batch.hidden,
        });
      importStatus.textContent =
        batch.entries.length === 0 ? t("import.nothingNew") : "";
      batchView.hidden = batch.entries.length === 0;
      break;
    }
    default:
      importState satisfies never;
  }
}

/** The picker, Skip, Next, Remark and blocked banner for the batch's current entry. */
function showEntry(batch: Batch, statuses: readonly EntryStatus[]): void {
  batchPicker.replaceChildren(
    ...batch.entries.map((entry, i) => {
      const status = statuses[i];
      if (status === undefined) throw new Error("an entry has no status");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset["status"] = status.kind;
      button.setAttribute("aria-current", String(i === batch.current));
      button.textContent = `${entry.sourceRow.transactionId} · ${t(`import.status.${status.kind}`)}`;
      button.addEventListener("click", () => {
        batch.current = i;
        loadCurrent();
      });
      return button;
    }),
  );
  const entry = entryAt(batch);
  const status = statuses[batch.current];
  if (status === undefined) throw new Error("the current entry has no status");
  skipButton.textContent = entry.skipped
    ? t("import.unskip")
    : t("import.skip");
  nextButton.disabled = batch.current === batch.entries.length - 1;
  remark.textContent = entry.sourceRow.remark;
  blockedText.textContent =
    status.kind === "blocked"
      ? [
          ...status.reasons.map(blockedBecause),
          t("import.blocked.fix", { itemNo: entry.sourceRow.itemNo }),
        ].join(" ")
      : "";
  switch (status.kind) {
    case "to-fill-in":
    case "warned":
      importEditor.flag(status.problems);
      break;
    case "ready":
    case "blocked":
    case "skipped":
      importEditor.flag([]);
      break;
    default:
      status satisfies never;
  }
}

function blockedBecause(reason: BlockReason): string {
  switch (reason.kind) {
    case "transactionId":
    case "amount":
    case "date":
      return t(`import.blocked.${reason.kind}`);
    case "duplicate":
      return t("import.blocked.duplicate", {
        rows: new Intl.ListFormat("en", { type: "conjunction" }).format(
          reason.itemNos,
        ),
      });
    default:
      return reason satisfies never;
  }
}

skipButton.addEventListener("click", () => {
  if (importState.kind !== "batch")
    throw new Error("Skip showed with no batch");
  const { batch } = importState;
  const entry = entryAt(batch);
  batch.entries[batch.current] = { ...entry, skipped: !entry.skipped };
  batch.edited = true;
  showSave();
});
nextButton.addEventListener("click", () => {
  if (importState.kind !== "batch")
    throw new Error("Next showed with no batch");
  importState.batch.current++;
  loadCurrent();
});
refreshButton.addEventListener("click", () => {
  if (importState.kind === "batch" && importState.batch.edited)
    refreshConfirm.hidden = false;
  else void read();
});
byId("button", "refresh-discard").addEventListener("click", () => {
  void read();
});
byId("button", "refresh-cancel").addEventListener("click", () => {
  refreshConfirm.hidden = true;
});
readAgainButton.addEventListener("click", () => {
  void read();
});

function showTab(): void {
  for (const [name, { tab, panel }] of Object.entries(tabs)) {
    tab.setAttribute("aria-selected", String(name === active));
    panel.hidden = name !== active;
  }
  showSave();
}

/** The Save button for the active tab, and why it is disabled. */
function showSave(): void {
  const fillReview = review(fillDraft, today());
  fillEditor.flag(fillReview.kind === "ready" ? [] : fillReview.problems);
  const statuses =
    importState.kind === "batch"
      ? reviewBatch(importState.batch.entries, today())
      : [];
  if (importState.kind === "batch" && importState.batch.entries.length > 0)
    showEntry(importState.batch, statuses);
  const why = [
    ...(template.kind === "none" ? [t("save.noTemplate")] : []),
    ...(data.folder.kind === "none" ? [t("save.noFolder")] : []),
  ];
  switch (active) {
    case "import": {
      const n = statuses.filter(
        (s) => s.kind === "ready" || s.kind === "warned",
      ).length;
      saveButton.textContent = t("save.many", { count: n });
      if (n === 0) why.push(t("save.nothingReady"));
      break;
    }
    case "fill-in":
      saveButton.textContent = t("save.one");
      if (fillReview.kind === "to-fill-in") why.push(t("save.toFillIn"));
      break;
    default:
      active satisfies never;
  }
  saveButton.disabled = why.length > 0;
  saveReason.textContent = why.join(" ");
}

for (const [name, { tab }] of Object.entries(tabs)) {
  tab.addEventListener("click", () => {
    // Object.entries loses the key type; the keys are tabs'.
    active = name as Tab;
    showTab();
  });
}

saveButton.addEventListener("click", () => {
  if (template.kind === "none" || data.folder.kind === "none")
    throw new Error("Save was clickable with nothing to save");
  const folderPath = data.folder.path;
  const bytes = template.template.bytes;
  const save =
    active === "import"
      ? () => saveBatch(folderPath, bytes)
      : () => saveFillInTab(folderPath, bytes);
  saveButton.disabled = true;
  void (async () => {
    await hub.busy.set(t("save.busy"));
    try {
      resultLog.clear();
      await save();
      result.hidden = false;
    } finally {
      await hub.busy.clear();
      showSave();
    }
  })();
});

async function saveFillInTab(
  folderPath: FolderPath,
  bytes: Uint8Array,
): Promise<void> {
  const fillReview = review(fillDraft, today());
  if (fillReview.kind === "to-fill-in")
    throw new Error("Save was clickable with nothing to save");
  const saved = await saveFillIn(folderPath, bytes, fillReview.invoice);
  const name = fileName(saved.invoiceNo);
  switch (saved.kind) {
    case "written":
      resultLog.append({ tone: "success", text: t("save.written", { name }) });
      fillDraft = blankDraft(today(), rememberedName());
      fillEditor.load(fillDraft, t("editor.assignedOnSave"));
      break;
    case "failed":
      resultLog.append({
        tone: "danger",
        text: t("save.failed", { name, message: saved.message }),
      });
      break;
    default:
      saved satisfies never;
  }
}

/** Writes each ready or warned entry in turn, past failures, then drops and records the saved ones. */
async function saveBatch(
  folderPath: FolderPath,
  bytes: Uint8Array,
): Promise<void> {
  if (importState.kind !== "batch")
    throw new Error("Save was clickable with no batch");
  const { batch } = importState;
  const statuses = reviewBatch(batch.entries, today());
  const saved: InvoiceNo[] = [];
  for (const status of statuses) {
    if (status.kind !== "ready" && status.kind !== "warned") continue;
    const { invoiceNo } = status.invoice;
    const name = fileName(invoiceNo);
    const outcome = await writeInvoice(folderPath, bytes, status.invoice);
    switch (outcome.kind) {
      case "written":
        resultLog.append({
          tone: "success",
          text: t("save.written", { name }),
        });
        saved.push(invoiceNo);
        break;
      case "exists":
        resultLog.append({ tone: "info", text: t("save.exists", { name }) });
        saved.push(invoiceNo);
        break;
      case "failed":
        resultLog.append({
          tone: "danger",
          text: t("save.failed", { name, message: outcome.message }),
        });
        break;
      default:
        outcome satisfies never;
    }
  }
  // By Transaction ID, since staff may have edited entries while it saved. A Refresh mid-save
  // replaces the batch; that read already hid nothing newer, so the next read hides these.
  const done = new Set<string>(saved);
  batch.entries = batch.entries.filter(
    (e) => !done.has(e.sourceRow.transactionId),
  );
  batch.current = Math.min(
    batch.current,
    Math.max(batch.entries.length - 1, 0),
  );
  update({ ...data, invoiced: [...data.invoiced, ...saved] });
  showImport();
  loadCurrent();
}

openFolderButton.addEventListener("click", () => {
  if (data.folder.kind === "none")
    throw new Error("a save showed with no folder");
  const path = data.folder.path;
  void (async () => {
    try {
      await hub.files.openFolder(path);
    } catch (e) {
      resultLog.append({ tone: "danger", text: notOpened(e) });
    }
  })();
});

/** Why `hub.files.openFolder` could not open the save folder. */
function notOpened(e: unknown): string {
  // Every window.hub rejection is a HubError (ADR 0009); TypeScript cannot type a promise's rejection.
  const err = e as HubError;
  switch (err.code) {
    case "folder-not-opened":
      return t("result.notOpened", { message: err.message });
    case "secret-name-invalid":
    case "secret-too-large":
    case "backend-error":
    case "store-not-declared":
    case "bad-path":
    case "not-found":
    case "no-provider":
    case "provider-missing":
    case "provider-rejected":
    case "provider-unreachable":
    case "exists":
    case "write-failed":
      throw new Error(`hub.files.openFolder refused with ${err.code}`);
    default: {
      const unreachable: never = err;
      throw new Error(`unhandled HubError ${String(unreachable)}`);
    }
  }
}
byId("button", "dismiss").addEventListener("click", () => {
  result.hidden = true;
});

sheetInput.value = data.sheet.kind === "set" ? sheetLink(data.sheet.id) : "";
folder.value = data.folder;

/** Whether everything was set at the last `show`, so Settings collapses only as the last one lands. */
let complete = false;
function show(): void {
  keyState.textContent = keyStored ? t("key.stored") : t("key.missing");
  templateState.textContent =
    template.kind === "imported"
      ? t("template.stored", { name: template.template.name })
      : t("template.missing");
  const missing = [
    ...(keyStored ? [] : [t("settings.item.key")]),
    ...(data.sheet.kind === "set" ? [] : [t("settings.item.sheet")]),
    ...(template.kind === "imported" ? [] : [t("settings.item.template")]),
    ...(data.folder.kind === "chosen" ? [] : [t("settings.item.folder")]),
  ];
  if (
    missing.length === 0 &&
    template.kind === "imported" &&
    data.folder.kind === "chosen"
  ) {
    summary.textContent = t("settings.done", {
      template: template.template.name,
      folder: data.folder.path,
    });
    if (!complete) settings.open = false;
    complete = true;
  } else {
    summary.textContent = t("settings.missing", { items: missing.join(", ") });
    settings.open = true;
    complete = false;
  }
  showSave();
}
show();
showTab();
void read();

/** Reads the sheet once the key and link are both set, if nothing was read for want of them. */
function readOnceSetUp(): void {
  if (importState.kind === "setup") void read();
}

keyFile.addEventListener("change", () => {
  void (async () => {
    const file = keyFile.files?.[0];
    if (file === undefined) return; // the picker was cancelled
    const text = await file.text();
    keyFile.value = ""; // choosing the same file again fires change again
    const picked = parseKey(text);
    if (picked.kind === "invalid") {
      keyError.textContent = t("key.invalid");
      return;
    }
    try {
      await hub.secrets.set(KEY_SECRET, text);
    } catch (e) {
      keyError.textContent = refusal(e);
      return;
    }
    keyError.textContent = "";
    key = picked;
    keyStored = true;
    show();
    readOnceSetUp();
  })();
});

sheetInput.addEventListener("change", () => {
  const parsed = parseSheetLink(sheetInput.value);
  if (parsed.kind === "invalid") {
    sheetError.textContent = t("sheet.invalid");
    return;
  }
  sheetError.textContent = "";
  sheetInput.value = sheetLink(parsed.id);
  update({ ...data, sheet: { kind: "set", id: parsed.id } });
  readOnceSetUp();
});

templateFile.addEventListener("change", () => {
  void (async () => {
    const file = templateFile.files?.[0];
    if (file === undefined) return; // the picker was cancelled
    const bytes = new Uint8Array(await file.arrayBuffer());
    templateFile.value = "";
    const check = await checkTemplate(bytes);
    switch (check.kind) {
      case "not-docx":
        templateError.textContent = t("template.notDocx");
        return;
      case "placeholders":
        templateError.textContent = [
          ...(check.missing.length > 0
            ? [
                t("template.missingPlaceholders", {
                  names: braces(check.missing),
                }),
              ]
            : []),
          ...(check.unknown.length > 0
            ? [
                t("template.unknownPlaceholders", {
                  names: braces(check.unknown),
                }),
              ]
            : []),
          t("template.kept"),
        ].join(" ");
        return;
      case "valid":
        break;
      default:
        check satisfies never;
    }
    const imported = { name: file.name, bytes };
    await saveTemplate(imported);
    templateError.textContent = "";
    template = { kind: "imported", template: imported };
    fillEditor.useTemplate(template);
    importEditor.useTemplate(template);
    show();
  })();
});

/** Placeholder names as staff type them in Word. */
function braces(names: readonly string[]): string {
  return names.map((name) => `{{${name}}}`).join(", ");
}

folder.addEventListener("change", () => {
  update({ ...data, folder: folder.value });
});

/** Why `hub.secrets.set` refused the key file. */
function refusal(e: unknown): string {
  // Every window.hub rejection is a HubError (ADR 0009); TypeScript cannot type a promise's rejection.
  const err = e as HubError;
  switch (err.code) {
    case "secret-too-large":
      return t("key.invalid"); // a real key is a few KiB, so this is the wrong file
    case "secret-name-invalid": // KEY_SECRET is a valid name
    case "backend-error":
    case "store-not-declared":
    case "bad-path":
    case "not-found":
    case "no-provider":
    case "provider-missing":
    case "provider-rejected":
    case "provider-unreachable":
    case "folder-not-opened":
    case "exists":
    case "write-failed":
      // hub.secrets.set raises none of these. The code only: the error names the secret.
      throw new Error(`hub.secrets.set refused with ${err.code}`);
    default: {
      const unreachable: never = err;
      throw new Error(`unhandled HubError ${String(unreachable)}`);
    }
  }
}
