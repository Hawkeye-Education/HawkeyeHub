// The Preview (spec #201, *Template*): the page column renders, with docx-preview, the very bytes
// fill.ts gives Save, scaled to fit, re-rendered a moment after staff stop typing. Problems are
// listed in a banner above the page and highlighted on it. A draft still to fill in prints what
// it can, with a mark where a value is missing.

import { renderAsync } from "docx-preview";
import { amountInWords, type HkdCents } from "./amountInWords";
import {
  fillPage,
  invoicePage,
  money,
  printedDate,
  printedNo,
  type Page,
} from "./fill";
import { t } from "./i18n";
import {
  CalendarDate,
  today,
  total,
  type InvoiceDraft,
  type Numbering,
} from "./invoice";
import { parseAmount, review, type Field, type Problem } from "./review";
import type { StoredTemplate } from "./template";

/** What the page shows: the draft numbered `invoiceNo`, filled into `template`. */
export interface PreviewState {
  readonly template: StoredTemplate;
  readonly draft: InvoiceDraft;
  readonly invoiceNo: Numbering;
  readonly problems: readonly Problem[];
}

export interface Preview {
  /** The page column. */
  readonly element: HTMLElement;
  /** Renders `state` once staff pause; a newer call replaces a pending one. */
  show(state: PreviewState): void;
}

/** How long typing must pause before the page re-renders. */
const DEBOUNCE_MS = 250;

/** Printed where a draft has no valid value yet. */
const MISSING = "⚠";

/** What a draft still to fill in prints: each valid value as Save prints it, MISSING elsewhere. */
function draftPage(draft: InvoiceDraft, invoiceNo: Numbering): Page {
  const shown = (value: string): string =>
    value.trim() === "" ? MISSING : value.trim();
  const date = CalendarDate.safeParse(draft.date);
  const amounts = draft.lineItems.map((item) => parseAmount(item.amount));
  const valid = amounts.filter((a): a is HkdCents => a !== "invalid");
  const sum = total(valid);
  // The total is unknown while any amount is.
  const totalKnown = valid.length === amounts.length && sum > 0;
  return {
    invoiceNo,
    date: date.success ? printedDate(date.data) : MISSING,
    receivedFrom: shown(draft.receivedFrom),
    studentName: shown(draft.studentName),
    lineItems: draft.lineItems.map((item, i) => {
      const amount = amounts[i];
      return {
        description: shown(item.description),
        amount:
          amount === undefined || amount === "invalid"
            ? MISSING
            : money(amount),
      };
    }),
    total: totalKnown ? money(sum) : "",
    amountInWords: totalKnown ? amountInWords(sum) : "",
    paymentMethod: draft.paymentMethod,
    otherText:
      draft.paymentMethod.kind === "other"
        ? shown(draft.paymentMethod.text)
        : "",
    remarks: draft.remarks.trim(),
    receivedBy: shown(draft.receivedBy),
  };
}

/** The text `field` printed on `page`: none for a field with no text of its own. */
function printedFor(page: Page, field: Field): readonly string[] {
  const item = /^item-(description|amount)-(\d+)$/.exec(field);
  if (item !== null) {
    const line = page.lineItems[Number(item[2])];
    if (line === undefined) return [];
    return [item[1] === "amount" ? line.amount : line.description];
  }
  switch (field) {
    case "invoiceNo":
      return [printedNo(page.invoiceNo)];
    case "date":
      return [page.date];
    case "receivedFrom":
      return [page.receivedFrom];
    case "studentName":
      return [page.studentName];
    case "paymentOtherText":
      return [page.otherText];
    case "receivedBy":
      return [page.receivedBy];
    case "paymentMethod": // unticked boxes: the banner names it
      return [];
    default:
      throw new Error(`no printed text for field ${field}`);
  }
}

/** The form's label for `field`, as the banner names it. */
function label(field: Field): string {
  const item = /^item-(description|amount)-(\d+)$/.exec(field);
  if (item !== null)
    return t("preview.line", {
      label: t(
        item[1] === "amount" ? "editor.itemAmount" : "editor.itemDescription",
      ),
      n: Number(item[2]) + 1,
    });
  switch (field) {
    case "invoiceNo":
      return t("editor.invoiceNo");
    case "date":
      return t("editor.date");
    case "receivedFrom":
      return t("editor.receivedFrom");
    case "studentName":
      return t("editor.studentName");
    case "paymentMethod":
      return t("editor.payment.label");
    case "paymentOtherText":
      return t("editor.payment.otherText");
    case "receivedBy":
      return t("editor.receivedBy");
    default:
      throw new Error(`no label for field ${field}`);
  }
}

/** Wraps each text node on `sheet` that reads one of `texts` in a `<mark>`. */
function highlight(sheet: HTMLElement, texts: ReadonlySet<string>): void {
  const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  // ponytail: matches by text, so an identical value elsewhere on the page lights up too.
  while (walker.nextNode() !== null) {
    // SHOW_TEXT visits only Text nodes; TreeWalker's type cannot say so.
    const node = walker.currentNode as Text;
    if (texts.has(node.data.trim())) hits.push(node);
  }
  for (const hit of hits) {
    const mark = document.createElement("mark");
    hit.replaceWith(mark);
    mark.append(hit);
  }
}

export function createPreview(): Preview {
  const element = document.createElement("div");
  element.className = "page stack-tight";
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped per render, so a slow older render never replaces a newer one. */
  let latest = 0;

  async function render(state: PreviewState): Promise<void> {
    const mine = ++latest;
    if (state.template.kind === "none") {
      const prompt = document.createElement("p");
      prompt.className = "muted";
      prompt.textContent = t("preview.noTemplate");
      element.replaceChildren(prompt);
      return;
    }
    const checked = review(state.draft, today());
    // A saveable draft prints through invoicePage, exactly as Save fills it.
    const page =
      checked.kind === "to-fill-in"
        ? draftPage(state.draft, state.invoiceNo)
        : invoicePage(checked.invoice, state.invoiceNo);
    const bytes = await fillPage(state.template.template.bytes, page);
    const sheet = document.createElement("div");
    await renderAsync(bytes, sheet, undefined, { inWrapper: true });
    if (mine !== latest) return;

    highlight(
      sheet,
      new Set(state.problems.flatMap((p) => printedFor(page, p.field))),
    );
    const banner = document.createElement("ul");
    banner.className = "problems";
    banner.hidden = state.problems.length === 0;
    banner.append(
      ...state.problems.map((problem) => {
        const li = document.createElement("li");
        li.textContent = `${label(problem.field)}: ${t(`problem.${problem.reason}`)}`;
        return li;
      }),
    );
    element.replaceChildren(banner, sheet);
    fit();
  }

  /** Scales the rendered page down to the column's width. */
  function fit(): void {
    const sheet = element.querySelector<HTMLElement>(".docx-wrapper");
    if (sheet === null) return; // the prompt shows, or nothing has rendered yet
    sheet.style.zoom = "";
    const natural = sheet.scrollWidth;
    // 0 while its tab is hidden; the observer fits it again once the tab shows.
    if (natural > 0)
      sheet.style.zoom = String(Math.min(1, element.clientWidth / natural));
  }
  new ResizeObserver(fit).observe(element);

  return {
    element,
    show(state) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void render(state);
      }, DEBOUNCE_MS);
    },
  };
}
