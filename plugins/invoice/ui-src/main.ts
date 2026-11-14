// Invoice's Plugin UI: plain DOM over native elements and the Hub Kit. This wires the Settings strip
// (settings.ts) and the two tabs, Import (import-tab.ts) and Fill in, to the one Save button and
// its result. Nothing here logs.

import type { FolderPath } from "@hawkeye-hub/hub-api";
import { byId } from "./dom";
import { createEditor } from "./editor";
import { hubError, refused } from "./hub-error";
import { t } from "./i18n";
import { createImportTab } from "./import-tab";
import { blankDraft, today, type InvoiceDraft } from "./invoice";
import { review } from "./review";
import { fileName, saveFillIn } from "./save";
import { createSettings } from "./settings";

const hub = window.hub;

const settings = await createSettings({
  changed: () => {
    showSave();
  },
  readable: () => {
    importTab.readIfSetUp();
  },
  templateImported: (template) => {
    fillEditor.useTemplate(template);
    importTab.useTemplate(template);
  },
});

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
/** Whether Save is writing: the forms and the sheet reads wait for it. */
let saving = false;
const saveButton = byId("button", "save");
const saveReason = byId("span", "save-reason");
const result = byId("section", "result");
const resultLog = byId("hub-log", "result-log");
const openFolderButton = byId("button", "open-folder");
tabs.import.tab.textContent = t("tab.import");
tabs["fill-in"].tab.textContent = t("tab.fillIn");
openFolderButton.textContent = t("result.openFolder");
byId("button", "dismiss").textContent = t("result.dismiss");

const rememberedName = (): string => {
  const { receivedBy } = settings.data();
  return receivedBy.kind === "set" ? receivedBy.name : "";
};
/** Remembers a newly typed Received by for later Invoices, then refreshes Save. */
function typed(draft: InvoiceDraft): void {
  const name = draft.receivedBy.trim();
  if (name !== "" && name !== rememberedName())
    settings.update({ ...settings.data(), receivedBy: { kind: "set", name } });
  else showSave();
}

// --- Fill in by hand ------------------------------------------------------------------------

let fillDraft = blankDraft(today(), rememberedName());
const fillEditor = createEditor("none", settings.template(), (draft) => {
  fillDraft = draft;
  typed(draft);
});
tabs["fill-in"].panel.append(fillEditor.element);
fillEditor.load(fillDraft, { kind: "on-save" });

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
      fillEditor.load(fillDraft, { kind: "on-save" });
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

// --- Import from Cash Flow Sheet ------------------------------------------------------------

const importTab = createImportTab(settings, {
  rememberedName,
  typed,
  showSave,
});

// --- The tabs and Save ----------------------------------------------------------------------

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
  const statuses = importTab.review();
  const why = [
    ...(settings.template().kind === "none" ? [t("save.noTemplate")] : []),
    ...(settings.data().folder.kind === "none" ? [t("save.noFolder")] : []),
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
  saveButton.disabled = saving || why.length > 0;
  saveReason.textContent = why.join(" ");
}

function setSaving(on: boolean): void {
  saving = on;
  fillEditor.setReadOnly(on);
  importTab.setSaving(on);
  showSave();
}

for (const [name, { tab }] of Object.entries(tabs)) {
  tab.addEventListener("click", () => {
    // Object.entries loses the key type; the keys are tabs'.
    active = name as Tab;
    showTab();
  });
}

saveButton.addEventListener("click", () => {
  const template = settings.template();
  const { folder } = settings.data();
  if (template.kind === "none" || folder.kind === "none")
    throw new Error("Save was clickable with nothing to save");
  const bytes = template.template.bytes;
  const save =
    active === "import"
      ? () => importTab.save(folder.path, bytes, resultLog)
      : () => saveFillInTab(folder.path, bytes);
  void (async () => {
    setSaving(true);
    await hub.busy.set(t("save.busy"));
    try {
      resultLog.clear();
      await save();
      result.hidden = false;
    } finally {
      await hub.busy.clear();
      setSaving(false);
    }
  })();
});

openFolderButton.addEventListener("click", () => {
  const { folder } = settings.data();
  if (folder.kind === "none") throw new Error("a save showed with no folder");
  void (async () => {
    try {
      await hub.files.openFolder(folder.path);
    } catch (e) {
      resultLog.append({ tone: "danger", text: notOpened(e) });
    }
  })();
});

/** Why `hub.files.openFolder` could not open the save folder. */
function notOpened(e: unknown): string {
  const err = hubError(e);
  if (err.code === "folder-not-opened")
    return t("result.notOpened", { message: err.message });
  return refused("hub.files.openFolder", err);
}
byId("button", "dismiss").addEventListener("click", () => {
  result.hidden = true;
});

settings.show();
showTab();
void importTab.read();
