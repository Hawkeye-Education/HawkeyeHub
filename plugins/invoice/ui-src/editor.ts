// The editing screen both tabs share (spec #201, *Layout*): the Invoice's form on the left, the page
// column on the right where the Preview renders. It holds the draft as staff type it and reports
// each change; the tab reviews the draft and hands the problems back to be flagged on their fields.

import { printedNo } from "./fill";
import { t } from "./i18n";
import {
  PAYMENT_KINDS,
  type DraftLineItem,
  type InvoiceDraft,
  type Numbering,
  type PaymentKind,
} from "./invoice";
import { createPreview } from "./preview";
import type { Field, Problem } from "./review";
import type { StoredTemplate } from "./template";

/**
 * `none`: every field editable, as in Fill in. `sheet-values`: the date and the line item's amount
 * came from the Cash Flow Sheet, so they are read-only and no line item can be added, as in Import.
 */
export type Locked = "none" | "sheet-values";

interface Shown {
  readonly draft: InvoiceDraft;
  readonly invoiceNo: Numbering;
}

export interface Editor {
  /** The editing screen, to place in a tab. */
  readonly element: HTMLElement;
  /** The right-hand column, where the Preview renders. */
  readonly page: HTMLElement;
  /** Shows `draft`, numbered `invoiceNo`. The page renders from the first load on. */
  load(draft: InvoiceDraft, invoiceNo: Numbering): void;
  /** Flags each problem on its field and on the page; fields not named are cleared. */
  flag(problems: readonly Problem[]): void;
  /** Re-renders the page in a changed template. */
  useTemplate(template: StoredTemplate): void;
  /** Makes every field read-only, or editable again: Save holds the form still while it writes. */
  setReadOnly(readOnly: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const made = Object.assign(document.createElement(tag), props);
  made.append(...children);
  return made;
}

export function createEditor(
  locked: Locked,
  template: StoredTemplate,
  onChange: (draft: InvoiceDraft) => void,
): Editor {
  // One fieldset around every field, so disabling it makes the whole form read-only.
  const fields = el("fieldset", { className: "stack" });
  const form = el("form", { className: "invoice-form" }, fields);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
  });
  const preview = createPreview();
  const element = el(
    "div",
    { className: "editing-screen" },
    form,
    preview.element,
  );

  /** What `load` last showed. None yet is real: Import flags its editor before any batch is read. */
  let shown: { readonly kind: "none" } | ({ readonly kind: "loaded" } & Shown) =
    { kind: "none" };
  /** Other's text, kept while another method is picked so choosing Other again restores it. */
  let otherText = "";
  let problems: readonly Problem[] = [];

  /** The loaded draft and number; the form only exists once `load` has run. */
  function loaded(): Shown {
    if (shown.kind === "none") throw new Error("the editor has nothing loaded");
    return shown;
  }

  function showPage(): void {
    if (shown.kind === "loaded")
      preview.show({
        template,
        draft: shown.draft,
        invoiceNo: shown.invoiceNo,
        problems,
      });
  }

  /** Applies one edit to the loaded draft and reports it. */
  function change(patch: Partial<InvoiceDraft>): void {
    const { draft, invoiceNo } = loaded();
    const next = { ...draft, ...patch };
    shown = { kind: "loaded", draft: next, invoiceNo };
    showPage();
    onChange(next);
  }

  /** A labelled control with the flag its field's problems show in. */
  function labelled(
    label: string,
    control: HTMLElement,
    field: Field,
  ): HTMLElement {
    control.dataset["field"] = field;
    return el(
      "label",
      { className: "stack-tight" },
      el("span", {}, label),
      control,
      flagFor(field),
    );
  }
  const flagFor = (field: Field): HTMLElement => {
    const flag = el("span", { className: "flag" });
    flag.dataset["flag"] = field;
    return flag;
  };

  function textInput(
    name: string,
    value: string,
    set: (value: string) => void,
    props: Partial<HTMLInputElement> = {},
  ): HTMLInputElement {
    const input = el("input", { name, value, type: "text", ...props });
    input.addEventListener("input", () => {
      set(input.value);
    });
    return input;
  }

  function lineItem(item: DraftLineItem, i: number): HTMLElement {
    const setItem = (patch: Partial<DraftLineItem>): void => {
      change({
        lineItems: loaded().draft.lineItems.map((it, j) =>
          j === i ? { ...it, ...patch } : it,
        ),
      });
    };
    return el(
      "div",
      { className: "line-item" },
      labelled(
        t("editor.itemDescription"),
        textInput("item-description", item.description, (description) => {
          setItem({ description });
        }),
        `item-description-${String(i)}`,
      ),
      labelled(
        t("editor.itemAmount"),
        textInput(
          "item-amount",
          item.amount,
          (amount) => {
            setItem({ amount });
          },
          { inputMode: "decimal", readOnly: locked === "sheet-values" },
        ),
        `item-amount-${String(i)}`,
      ),
    );
  }

  function paymentMethod(): HTMLElement {
    const chosen = loaded().draft.paymentMethod;
    const radio = (value: PaymentKind | "other"): HTMLElement => {
      const input = el("input", {
        type: "radio",
        name: "paymentMethod",
        value,
        checked: chosen.kind === value,
      });
      input.addEventListener("change", () => {
        change({
          paymentMethod:
            value === "other"
              ? { kind: "other", text: otherText }
              : { kind: value },
        });
      });
      return el(
        "label",
        { className: "choice" },
        input,
        t(`editor.payment.${value}`),
      );
    };
    if (chosen.kind === "other") otherText = chosen.text;
    const other = textInput("paymentOtherText", otherText, (text) => {
      otherText = text;
      if (loaded().draft.paymentMethod.kind === "other")
        change({ paymentMethod: { kind: "other", text } });
    });
    other.dataset["field"] = "paymentOtherText";
    other.setAttribute("aria-label", t("editor.payment.otherText"));
    const group = el(
      "fieldset",
      { className: "stack-tight" },
      el("legend", {}, t("editor.payment.label")),
      ...PAYMENT_KINDS.map(radio),
      el("span", { className: "choice" }, radio("other"), other),
      flagFor("paymentOtherText"),
      flagFor("paymentMethod"),
    );
    group.dataset["field"] = "paymentMethod";
    return group;
  }

  function render(): void {
    const { draft, invoiceNo } = loaded();
    const remarks = el("textarea", {
      name: "remarks",
      value: draft.remarks,
      rows: 2,
    });
    remarks.addEventListener("input", () => {
      change({ remarks: remarks.value });
    });
    const add = el(
      "button",
      { type: "button", className: "add-line-item" },
      t("editor.addLineItem"),
    );
    add.addEventListener("click", () => {
      change({
        lineItems: [
          ...loaded().draft.lineItems,
          { description: "", amount: "" },
        ],
      });
      render();
    });
    const number = el(
      "output",
      { className: "invoice-no" },
      printedNo(invoiceNo),
    );
    number.dataset["field"] = "invoiceNo";
    fields.replaceChildren(
      el(
        "div",
        { className: "stack-tight" },
        el("span", {}, t("editor.invoiceNo")),
        number,
        flagFor("invoiceNo"),
      ),
      labelled(
        t("editor.date"),
        textInput(
          "date",
          draft.date,
          (date) => {
            change({ date });
          },
          { type: "date", readOnly: locked === "sheet-values" },
        ),
        "date",
      ),
      labelled(
        t("editor.receivedFrom"),
        textInput("receivedFrom", draft.receivedFrom, (receivedFrom) => {
          change({ receivedFrom });
        }),
        "receivedFrom",
      ),
      labelled(
        t("editor.studentName"),
        textInput("studentName", draft.studentName, (studentName) => {
          change({ studentName });
        }),
        "studentName",
      ),
      el(
        "fieldset",
        { className: "stack-tight" },
        el("legend", {}, t("editor.lineItems")),
        ...draft.lineItems.map(lineItem),
        ...(locked === "none" ? [add] : []),
      ),
      paymentMethod(),
      el(
        "label",
        { className: "stack-tight" },
        el("span", {}, t("editor.remarks")),
        remarks,
      ),
      labelled(
        t("editor.receivedBy"),
        textInput("receivedBy", draft.receivedBy, (receivedBy) => {
          change({ receivedBy });
        }),
        "receivedBy",
      ),
    );
    flag(problems);
  }

  function flag(next: readonly Problem[]): void {
    problems = next;
    for (const control of form.querySelectorAll<HTMLElement>("[data-field]")) {
      const flagged = problems.some(
        (p) => p.field === control.dataset["field"],
      );
      control.setAttribute("aria-invalid", String(flagged));
    }
    for (const flagEl of form.querySelectorAll<HTMLElement>("[data-flag]")) {
      const problem = problems.find((p) => p.field === flagEl.dataset["flag"]);
      flagEl.textContent =
        problem === undefined ? "" : t(`problem.${problem.reason}`);
    }
    showPage();
  }

  return {
    element,
    page: preview.element,
    load(draft, invoiceNo) {
      shown = { kind: "loaded", draft, invoiceNo };
      otherText = "";
      render();
    },
    flag,
    useTemplate(next) {
      template = next;
      showPage();
    },
    setReadOnly(readOnly) {
      fields.disabled = readOnly;
    },
  };
}
