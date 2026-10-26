// The Receipt Extractor's Plugin UI: plain DOM over native elements.

import { buildDocx, suggestedName } from "./docx";
import { t } from "./i18n";
import { extract, type Extracted, type Receipt } from "./receipt";

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
const files = byId("input", "files");
const run = byId("button", "run");
const save = byId("button", "save");
const summary = byId("p", "summary");
const list = byId("ol", "list");

byId("span", "files-label").textContent = t("files");
byId("p", "hint").textContent = t("hint");
run.textContent = t("run");
save.textContent = t("save");

// Explorer and Finder order: "receipt 2" before "receipt 10".
const byName = new Intl.Collator("en", { numeric: true }).compare;

let picked: File[] = [];
let receipts: Receipt[] = [];
let thumbnails: string[] = [];

function item(name: string, ...extra: Node[]): HTMLLIElement {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = name;
  li.append(...extra, label);
  return li;
}

function choose(chosen: readonly File[]): void {
  if (files.disabled) return; // a run is going; it keeps the files it started with
  picked = [...chosen].sort((a, b) => byName(a.name, b.name));
  receipts = [];
  for (const url of thumbnails) URL.revokeObjectURL(url);
  thumbnails = [];
  list.replaceChildren(...picked.map((f) => item(f.name)));
  summary.textContent = "";
  run.disabled = picked.length === 0;
  save.disabled = true;
}

files.addEventListener("change", () => {
  choose([...(files.files ?? [])]);
});
document.addEventListener("dragover", (e) => {
  e.preventDefault(); // allows the drop
});
document.addEventListener("drop", (e) => {
  e.preventDefault(); // Chromium would otherwise open the dropped file in place of the Plugin UI
  choose([...(e.dataTransfer?.files ?? [])]);
});

/** A result's line in the list, `name` with its thumbnail or flag; a receipt joins the document. */
function show(name: string, extracted: Extracted): HTMLLIElement {
  switch (extracted.kind) {
    case "receipt": {
      receipts.push(extracted.receipt);
      const img = document.createElement("img");
      const url = URL.createObjectURL(
        new Blob([extracted.receipt.jpeg], { type: "image/jpeg" }),
      );
      thumbnails.push(url);
      img.src = url;
      img.alt = "";
      return item(name, img);
    }
    case "failed": {
      const flag = document.createElement("strong");
      flag.textContent = t(`failed.${extracted.reason}`);
      return item(name, flag);
    }
    default:
      extracted satisfies never;
      throw new Error("unreachable");
  }
}

async function extractAll(): Promise<void> {
  files.disabled = true;
  run.disabled = true;
  save.disabled = true;
  summary.textContent = "";
  await hub.busy.set(t("busy"));
  try {
    receipts = [];
    let total = 0;
    // Each file's line in the list, which its results replace: one per page for a PDF.
    const lines = [...list.children];
    for (const [i, file] of picked.entries()) {
      const fromFile = await extract(file);
      let shown: HTMLLIElement[];
      switch (fromFile.kind) {
        case "whole":
          shown = [show(file.name, fromFile.extracted)];
          break;
        case "pages":
          shown = fromFile.pages.map((extracted, p) =>
            show(t("page", { name: file.name, page: p + 1 }), extracted),
          );
          break;
        default:
          fromFile satisfies never;
          throw new Error("unreachable");
      }
      total += shown.length;
      lines[i]?.replaceWith(...shown);
    }
    summary.textContent = t("summary", { receipts: receipts.length, total });
  } finally {
    await hub.busy.clear();
    files.disabled = false;
    run.disabled = false;
    save.disabled = receipts.length === 0;
  }
}

run.addEventListener("click", () => {
  void extractAll();
});

save.addEventListener("click", () => {
  const [first, ...rest] = picked.map((f) => f.name);
  if (first === undefined) return; // Save is enabled only after a run made a receipt
  const name = suggestedName([first, ...rest], new Date());
  void buildDocx(receipts).then((docx) => {
    const a = document.createElement("a");
    // ponytail: never revoked, since the Hub's save dialog reads it after the click; one
    // document per Save, freed when the Plugin closes.
    a.href = URL.createObjectURL(docx);
    a.download = name;
    a.click();
  });
});
