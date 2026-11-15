// Fills the Official Receipt template with one Invoice: (template bytes, Invoice) → `.docx` bytes.
// Save writes these bytes and the Preview renders the same ones. Signature and Company Chop have
// no placeholder, so they stay as the template has them, blank for wet ink.

import { patchDocument, PatchType, TextRun, type IPatch } from "docx";
import { amountInWords, type HkdCents } from "./amountInWords";
import { t } from "./i18n";
import {
  total,
  type CalendarDate,
  type Invoice,
  type InvoiceFields,
  type Numbering,
  type PaymentMethod,
} from "./invoice";

/** `1,234.50`: amounts print without `HKD$`. */
export function money(cents: HkdCents): string {
  return `${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

/** `2026-03-15` → `15/03/2026`. */
export function printedDate(date: CalendarDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** What `{{invoice_no}}` and the editor's Receipt No. show. */
export function printedNo(numbering: Numbering): string {
  switch (numbering.kind) {
    case "assigned":
      return numbering.invoiceNo;
    case "on-save":
      return t("editor.assignedOnSave");
    case "invalid":
      return numbering.transactionId;
    default:
      return numbering satisfies never;
  }
}

/** The text each placeholder prints. The Preview prints a draft still being typed through it too. */
export interface Page {
  readonly invoiceNo: Numbering;
  readonly date: string;
  readonly receivedFrom: string;
  readonly studentName: string;
  readonly lineItems: readonly {
    readonly description: string;
    readonly amount: string;
  }[];
  readonly total: string;
  readonly amountInWords: string;
  /** No method chosen yet is a draft's state: every box prints unticked. */
  readonly paymentMethod: PaymentMethod | { readonly kind: "none" };
  readonly otherText: string;
  readonly remarks: string;
  readonly receivedBy: string;
}

/** What an Invoice's fields print, numbered `invoiceNo`. */
export function invoicePage(fields: InvoiceFields, invoiceNo: Numbering): Page {
  const sum = total(fields.lineItems.map((item) => item.amount));
  return {
    invoiceNo,
    date: printedDate(fields.date),
    receivedFrom: fields.receivedFrom,
    studentName: fields.studentName,
    lineItems: fields.lineItems.map((item) => ({
      description: item.description,
      amount: money(item.amount),
    })),
    total: money(sum),
    amountInWords: amountInWords(sum),
    paymentMethod: fields.paymentMethod,
    otherText:
      fields.paymentMethod.kind === "other" ? fields.paymentMethod.text : "",
    remarks: fields.remarks.kind === "some" ? fields.remarks.text : "",
    receivedBy: fields.receivedBy,
  };
}

/** Each line its own run, so a multi-line value keeps its line breaks. */
function text(value: string): IPatch {
  return {
    type: PatchType.PARAGRAPH,
    children: value
      .split("\n")
      .map((line, i) =>
        i === 0 ? new TextRun(line) : new TextRun({ text: line, break: 1 }),
      ),
  };
}

const tick = (on: boolean): IPatch => text(on ? "☑" : "☐");

export async function fillTemplate(
  template: Uint8Array,
  invoice: Invoice,
): Promise<Uint8Array> {
  return fillPage(
    template,
    invoicePage(invoice, { kind: "assigned", invoiceNo: invoice.invoiceNo }),
  );
}

/** Fills the template with `page`'s text. */
export async function fillPage(
  template: Uint8Array,
  page: Page,
): Promise<Uint8Array> {
  // docx's TABLE_ROWS repeats rows holding `{{item.field}}`, but staff type `{{item_description}}`
  // (spec #201's placeholder table), so a first pass renames them in place, keeping their styles.
  const renamed = await patchDocument({
    outputType: "uint8array",
    data: template,
    keepOriginalStyles: true,
    patches: {
      item_description: text("{{item.description}}"),
      item_amount: text("{{item.amount}}"),
    },
  });
  const method = page.paymentMethod.kind;
  return patchDocument({
    outputType: "uint8array",
    data: renamed,
    keepOriginalStyles: true,
    patches: {
      item: {
        type: PatchType.TABLE_ROWS,
        rows: page.lineItems.map((item) => ({
          description: text(item.description),
          amount: text(item.amount),
        })),
      },
      invoice_no: text(printedNo(page.invoiceNo)),
      date: text(page.date),
      received_from: text(page.receivedFrom),
      student_name: text(page.studentName),
      total: text(page.total),
      amount_in_words: text(page.amountInWords),
      pay_cash: tick(method === "cash"),
      pay_bank_transfer: tick(method === "bank-transfer"),
      pay_fps: tick(method === "fps"),
      pay_cheque: tick(method === "cheque"),
      pay_other: tick(method === "other"),
      pay_other_text: text(page.otherText),
      remarks: text(page.remarks),
      received_by: text(page.receivedBy),
    },
  });
}
