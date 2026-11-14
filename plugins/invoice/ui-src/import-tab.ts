// Import from Cash Flow Sheet: reads the sheet into a batch of Invoices, one per new Revenues row,
// walks staff through them, and saves the ready ones. Save itself, and the Save button, are main's.

import type { FolderPath } from "@hawkeye-hub/hub-api";
import { byId } from "./dom";
import { createEditor } from "./editor";
import {
  parseCashFlow,
  readSheet,
  SheetReadFailed,
  type ReadFailure,
} from "./google";
import { t } from "./i18n";
import { InvoiceNo, today, type InvoiceDraft } from "./invoice";
import {
  importEntry,
  reviewBatch,
  sheetProblems,
  type BlockReason,
  type EntryStatus,
  type ImportEntry,
} from "./review";
import { fileName, writeInvoice } from "./save";
import type { Settings } from "./settings";
import type { StoredTemplate } from "./template";

export interface ImportTab {
  /** Reads the sheet into a fresh batch, replacing the last one. */
  read(): Promise<void>;
  /** Reads the sheet if nothing was read for want of the key or the link. */
  readIfSetUp(): void;
  /** Shows the current entry's status, and returns every entry's in sheet order (none before a batch). */
  review(): readonly EntryStatus[];
  /** Writes each ready or warned entry in turn, past failures, then drops and records the saved ones. */
  save(
    folder: FolderPath,
    template: Uint8Array,
    log: HTMLElementTagNameMap["hub-log"],
  ): Promise<void>;
  /** Holds the form and the sheet reads still while Save writes. */
  setSaving(saving: boolean): void;
  useTemplate(template: StoredTemplate): void;
}

export interface ImportHost {
  /** The Received by staff typed last, or none yet. */
  rememberedName(): string;
  /** Staff typed into an Invoice. */
  typed(draft: InvoiceDraft): void;
  /** What Save shows may have changed. */
  showSave(): void;
}

/**
 * The tab's state. `batch.entries` is the batch in sheet order; Save writes each entry
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
}

/** Whether an entry is skipped or differs from its sheet row, so Refresh asks before discarding it. */
function edited(batch: Batch): boolean {
  return batch.entries.some((e) => {
    // Received by is remembered across reads, so a name alone loses nothing. Both drafts are built
    // by importEntry and the editor's spreads, so their keys stringify in the same order.
    const fresh = importEntry(e.sourceRow, e.draft.receivedBy).draft;
    return e.skipped || JSON.stringify(e.draft) !== JSON.stringify(fresh);
  });
}

function entryAt(batch: Batch): ImportEntry {
  const entry = batch.entries[batch.current];
  if (entry === undefined) throw new Error("the current entry is gone");
  return entry;
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

export function createImportTab(
  settings: Settings,
  host: ImportHost,
): ImportTab {
  let importState: ImportState = { kind: "setup" };
  /** Whether Save is writing: the form and the sheet reads wait for it. */
  let saving = false;

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

  const editor = createEditor("sheet-values", settings.template(), (draft) => {
    if (importState.kind !== "batch")
      throw new Error("the Import editor changed with no batch");
    const { batch } = importState;
    batch.entries[batch.current] = { ...entryAt(batch), draft };
    host.typed(draft);
  });
  batchView.append(editor.element);

  async function read(): Promise<void> {
    const key = settings.key();
    const link = settings.data().sheet;
    if (key.kind === "invalid" || link.kind === "none") {
      importState = { kind: "setup" };
      showImport();
      return;
    }
    importState = { kind: "reading" };
    showImport();
    let grid: string[][];
    try {
      grid = await readSheet(key.key, link.id);
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
    const done = new Set<string>(settings.data().invoiced);
    const fresh = sheet.rows.filter((r) => !done.has(r.transactionId));
    importState = {
      kind: "batch",
      batch: {
        entries: fresh.map((r) => importEntry(r, host.rememberedName())),
        hidden: sheet.rows.length - fresh.length,
        current: 0,
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
        draft: { ...entry.draft, receivedBy: host.rememberedName() },
      };
      batch.entries[batch.current] = entry;
    }
    const { transactionId } = entry.sourceRow;
    const invoiceNo = InvoiceNo.safeParse(transactionId);
    editor.load(
      entry.draft,
      invoiceNo.success
        ? { kind: "assigned", invoiceNo: invoiceNo.data }
        : { kind: "invalid", transactionId },
    );
    host.showSave();
  }

  /** The tab for `importState`: its message, the batch and the current entry's status. */
  function showImport(): void {
    refreshConfirm.hidden = true;
    // A read mid-save would replace the batch Save is writing from.
    refreshButton.disabled = importState.kind === "reading" || saving;
    readAgainButton.disabled = saving;
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
        const key = settings.key();
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
    if (status === undefined)
      throw new Error("the current entry has no status");
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
        editor.flag(status.problems);
        break;
      case "blocked":
        editor.flag(sheetProblems(status.reasons));
        break;
      case "ready":
      case "skipped":
        editor.flag([]);
        break;
      default:
        status satisfies never;
    }
  }

  skipButton.addEventListener("click", () => {
    if (importState.kind !== "batch")
      throw new Error("Skip showed with no batch");
    const { batch } = importState;
    const entry = entryAt(batch);
    batch.entries[batch.current] = { ...entry, skipped: !entry.skipped };
    host.showSave();
  });
  nextButton.addEventListener("click", () => {
    if (importState.kind !== "batch")
      throw new Error("Next showed with no batch");
    importState.batch.current++;
    loadCurrent();
  });
  refreshButton.addEventListener("click", () => {
    if (importState.kind === "batch" && edited(importState.batch))
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

  async function save(
    folder: FolderPath,
    template: Uint8Array,
    log: HTMLElementTagNameMap["hub-log"],
  ): Promise<void> {
    if (importState.kind !== "batch")
      throw new Error("Save was clickable with no batch");
    const statuses = reviewBatch(importState.batch.entries, today());
    const saved: InvoiceNo[] = [];
    for (const status of statuses) {
      if (status.kind !== "ready" && status.kind !== "warned") continue;
      const { invoiceNo } = status.invoice;
      const name = fileName(invoiceNo);
      const outcome = await writeInvoice(folder, template, status.invoice);
      switch (outcome.kind) {
        case "written":
          log.append({ tone: "success", text: t("save.written", { name }) });
          saved.push(invoiceNo);
          break;
        case "exists":
          log.append({ tone: "info", text: t("save.exists", { name }) });
          saved.push(invoiceNo);
          break;
        case "failed":
          log.append({
            tone: "danger",
            text: t("save.failed", { name, message: outcome.message }),
          });
          break;
        default:
          outcome satisfies never;
      }
    }
    // From the live batch, by Transaction ID: staff may have picked another entry meanwhile. Reads
    // wait for Save, so it is still the batch this save started from.
    const { batch } = importState;
    const done = new Set<string>(saved);
    batch.entries = batch.entries.filter(
      (e) => !done.has(e.sourceRow.transactionId),
    );
    batch.current = Math.min(
      batch.current,
      Math.max(batch.entries.length - 1, 0),
    );
    const data = settings.data();
    settings.update({ ...data, invoiced: [...data.invoiced, ...saved] });
    showImport();
    loadCurrent();
  }

  return {
    read,
    readIfSetUp() {
      if (importState.kind === "setup") void read();
    },
    review() {
      if (importState.kind !== "batch") return [];
      const { batch } = importState;
      const statuses = reviewBatch(batch.entries, today());
      if (batch.entries.length > 0) showEntry(batch, statuses);
      return statuses;
    },
    save,
    setSaving(on) {
      saving = on;
      editor.setReadOnly(on);
      showImport();
    },
    useTemplate(template) {
      editor.useTemplate(template);
    },
  };
}
