// The PDF Watermark Eraser's Plugin UI: plain DOM over native elements and the Hub Kit.

import type { FolderFieldValue } from "@hawkeye-hub/hub-api/hub-kit";
import { explain } from "./explain";
import { backend, hub } from "./hub";
import { t } from "./i18n";
import {
  ListPdfsResult,
  PageTextResult,
  Progress,
  RunResult,
} from "./protocol";
import { loadSettings, saveSettings, type Settings } from "./settings";

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

const input = byId("hub-folder-field", "input");
const output = byId("hub-folder-field", "output");
const pattern = byId("input", "pattern");
const regex = byId("input", "regex");
const ignoreCase = byId("input", "ignore-case");
const file = byId("select", "file");
const page = byId("input", "page");
const show = byId("button", "show");
const copy = byId("button", "copy");
const repeated = byId("p", "repeated");
const pageTextView = byId("pre", "text");
const run = byId("button", "run");
const cancel = byId("button", "cancel");
const openOutput = byId("button", "open-output");
const progress = byId("progress", "progress");
const summary = byId("p", "summary");
const log = byId("hub-log", "log");

input.label = t("input");
output.label = t("output");
byId("span", "pattern-label").textContent = t("pattern");
byId("span", "regex-label").textContent = t("regex");
byId("span", "ignore-case-label").textContent = t("ignoreCase");
byId("summary", "finder").textContent = t("finder");
byId("p", "finder-hint").textContent = t("finderHint");
byId("span", "file-label").textContent = t("file");
byId("span", "page-label").textContent = t("page");
show.textContent = t("show");
copy.textContent = t("copy");
run.textContent = t("run");
cancel.textContent = t("cancel");
openOutput.textContent = t("openOutput");

// --- Plugin Data: what staff chose last time ---
const settings: Settings = loadSettings();
input.value = settings.input;
output.value = settings.output;
pattern.value = settings.pattern;
regex.checked = settings.regex;
ignoreCase.checked = settings.ignoreCase;

function save(): void {
  saveSettings({
    v: 1,
    input: input.value,
    output: output.value,
    pattern: pattern.value,
    regex: regex.checked,
    ignoreCase: ignoreCase.checked,
  });
}
for (const el of [output, pattern, regex, ignoreCase]) {
  el.addEventListener("change", save);
}

function option(text: string): HTMLOptionElement {
  const el = document.createElement("option");
  el.textContent = text;
  return el;
}

// --- Finding the watermark text: the Backend reads the PDF, the UI copies with the clipboard ---
async function listPdfs(folder: FolderFieldValue): Promise<void> {
  file.replaceChildren();
  show.disabled = true;
  if (folder.kind === "none") return;
  const { files } = ListPdfsResult.parse(
    await backend.request("listPdfs", { folder: folder.path }),
  );
  if (files.length === 0) {
    file.append(option(t("noPdfs")));
    return;
  }
  file.append(...files.map((f) => option(f)));
  show.disabled = false;
}

function showListing(folder: FolderFieldValue): void {
  listPdfs(folder).catch((e: unknown) => {
    summary.textContent = explain(e);
  });
}

input.addEventListener("change", () => {
  save();
  showListing(input.value);
});

// The page text Copy copies: none until Show text succeeds.
let shown: { kind: "none" } | { kind: "shown"; text: string } = {
  kind: "none",
};
show.addEventListener("click", () => {
  void (async () => {
    // Show is enabled only once the input folder has PDFs.
    if (input.value.kind === "none") return;
    try {
      const result = PageTextResult.parse(
        await backend.request("pageText", {
          folder: input.value.path,
          file: file.value,
          page: page.valueAsNumber - 1, // staff count from 1, the Backend from 0
        }),
      );
      shown = { kind: "shown", text: result.lines.join("\n") };
      pageTextView.textContent = shown.text;
      repeated.textContent =
        result.repeated.length > 0
          ? t("repeated", { lines: result.repeated.join(" · ") })
          : "";
      copy.disabled = false;
    } catch (e) {
      shown = { kind: "none" };
      pageTextView.textContent = explain(e);
      copy.disabled = true;
    }
  })();
});

const COPIED_MS = 1500;
copy.addEventListener("click", () => {
  // Copy is enabled only while page text is shown.
  if (shown.kind === "none") return;
  void navigator.clipboard.writeText(shown.text).then(() => {
    copy.textContent = t("copied");
    setTimeout(() => (copy.textContent = t("copy")), COPIED_MS);
  });
});

// --- Run: one request, progress notifications, Busy throughout ---
let lastDone = 0;
backend.onNotification("progress", (raw) => {
  const { done, total, file: name, result } = Progress.parse(raw);
  progress.value = done / total;
  lastDone = done;
  switch (result.kind) {
    case "cleaned":
      log.append({
        tone: "success",
        text: t("result.cleaned", { file: name, count: result.removed }),
      });
      return;
    case "no-match":
    case "password":
      log.append({
        tone: "danger",
        text: t(`result.${result.kind}`, { file: name }),
      });
      return;
    case "error":
      log.append({
        tone: "danger",
        text: t("result.error", { file: name, detail: result.detail }),
      });
      return;
    default:
      result satisfies never;
  }
});

async function erase(from: string, to: string): Promise<void> {
  log.clear();
  lastDone = 0;
  progress.value = 0;
  summary.textContent = "";
  openOutput.hidden = true;
  run.disabled = true;
  cancel.hidden = false;
  await hub.busy.set(t("busy"));
  try {
    const result = RunResult.parse(
      await backend.request("run", {
        input: from,
        output: to,
        pattern: pattern.value,
        regex: regex.checked,
        ignoreCase: ignoreCase.checked,
      }),
    );
    summary.textContent = result.cancelled
      ? t("summaryCancelled", { done: lastDone, total: result.total })
      : t("summary", result);
    openOutput.hidden = result.cleaned === 0;
  } catch (e) {
    summary.textContent = explain(e);
  } finally {
    await hub.busy.clear();
    run.disabled = false;
    cancel.hidden = true;
  }
}

run.addEventListener("click", () => {
  save();
  if (input.value.kind === "none" || output.value.kind === "none") {
    summary.textContent = t("pickFolders");
    return;
  }
  void erase(input.value.path, output.value.path);
});

cancel.addEventListener("click", () => {
  void backend.notify("cancel", {});
});

openOutput.addEventListener("click", () => {
  // Shown only after a run that cleaned something, which needs an output folder.
  if (output.value.kind === "none") return;
  hub.files.openFolder(output.value.path).catch((e: unknown) => {
    summary.textContent = explain(e);
  });
});

showListing(input.value);
