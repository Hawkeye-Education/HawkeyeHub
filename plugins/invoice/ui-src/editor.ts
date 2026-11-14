// The editing screen both tabs share (spec #201, *Layout*): the Invoice's form on the left, the page
// column on the right where the Preview renders. It holds the draft as staff type it and reports
// each change; the tab reviews the draft and hands the problems back to be flagged on their fields.

import { t } from "./i18n";
import {
  PAYMENT_KINDS,
  type DraftLineItem,
  type InvoiceDraft,
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

export interface Editor {
  /** The editing screen, to place in a tab. */
  readonly element: HTMLElement;
  /** The right-hand column, where the Preview renders. */
  readonly page: HTMLElement;
  /** Shows `draft`, numbered `invoiceNo` (a number, or "Assigned on Save"). The page renders from the first load on. */
  load(draft: InvoiceDraft, invoiceNo: string): void;
  /** Flags each problem on its field and on the page; fields not named are cleared. */
  flag(problems: readonly Problem[]): void;
  /** Re-renders the page in a changed template. */
  useTemplate(template: StoredTemplate): void;
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
  const form = el("form", { className: "invoice-form stack" });
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

  let draft: InvoiceDraft;
  let invoiceNo = "";
  /** Other's text, kept while another method is picked so choosing Other again restores it. */
  let otherText = "";
  let problems: readonly Problem[] = [];

  /** Whether `load` has run: Import flags its editor before any batch is read. */
  let loaded = false;
  function showPage(): void {
    if (loaded) preview.show({ template, draft, invoiceNo, problems });
  }

  function change(next: InvoiceDraft): void {
    draft = next;
    showPage();
    onChange(draft);
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
        ...draft,
        lineItems: draft.lineItems.map((it, j) =>
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
    const chosen = draft.paymentMethod;
    const radio = (value: PaymentKind | "other"): HTMLElement => {
      const input = el("input", {
        type: "radio",
        name: "paymentMethod",
        value,
        checked: chosen.kind === value,
      });
      input.addEventListener("change", () => {
        change({
          ...draft,
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
      if (draft.paymentMethod.kind === "other")
        change({ ...draft, paymentMethod: { kind: "other", text } });
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
    const remarks = el("textarea", {
      name: "remarks",
      value: draft.remarks,
      rows: 2,
    });
    remarks.addEventListener("input", () => {
      change({ ...draft, remarks: remarks.value });
    });
    const add = el(
      "button",
      { type: "button", className: "add-line-item" },
      t("editor.addLineItem"),
    );
    add.addEventListener("click", () => {
      draft = {
        ...draft,
        lineItems: [...draft.lineItems, { description: "", amount: "" }],
      };
      render();
      showPage();
      onChange(draft);
    });
    form.replaceChildren(
      el(
        "div",
        { className: "stack-tight" },
        el("span", {}, t("editor.invoiceNo")),
        el("output", { className: "invoice-no" }, invoiceNo),
      ),
      labelled(
        t("editor.date"),
        textInput(
          "date",
          draft.date,
          (date) => {
            change({ ...draft, date });
          },
          { type: "date", readOnly: locked === "sheet-values" },
        ),
        "date",
      ),
      labelled(
        t("editor.receivedFrom"),
        textInput("receivedFrom", draft.receivedFrom, (receivedFrom) => {
          change({ ...draft, receivedFrom });
        }),
        "receivedFrom",
      ),
      labelled(
        t("editor.studentName"),
        textInput("studentName", draft.studentName, (studentName) => {
          change({ ...draft, studentName });
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
          change({ ...draft, receivedBy });
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
    load(next, number) {
      draft = next;
      invoiceNo = number;
      otherText = "";
      loaded = true;
      render();
    },
    flag,
    useTemplate(next) {
      template = next;
      showPage();
    },
  };
}
