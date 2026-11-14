// Fills the Official Receipt template with one Invoice: (template bytes, Invoice) → `.docx` bytes.
// Save writes these bytes and the Preview renders the same ones. Signature and Company Chop have
// no placeholder, so they stay as the template has them, blank for wet ink.

import { patchDocument, PatchType, TextRun, type IPatch } from "docx";
import { amountInWords, type HkdCents } from "./amountInWords";
import {
  total,
  type CalendarDate,
  type Invoice,
  type PaymentMethod,
} from "./invoice";

/** `1,234.50`: amounts print without `HKD$`. */
export function money(cents: HkdCents): string {
  return `${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

/** `2026-03-15` → `15/03/2026`. */
function printedDate(date: CalendarDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
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

function ticks(method: PaymentMethod): Record<string, IPatch> {
  return {
    pay_cash: tick(method.kind === "cash"),
    pay_bank_transfer: tick(method.kind === "bank-transfer"),
    pay_fps: tick(method.kind === "fps"),
    pay_cheque: tick(method.kind === "cheque"),
    pay_other: tick(method.kind === "other"),
    pay_other_text: text(method.kind === "other" ? method.text : ""),
  };
}

export async function fillTemplate(
  template: Uint8Array,
  invoice: Invoice,
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
  const sum = total(invoice.lineItems);
  return patchDocument({
    outputType: "uint8array",
    data: renamed,
    keepOriginalStyles: true,
    patches: {
      item: {
        type: PatchType.TABLE_ROWS,
        rows: invoice.lineItems.map((item) => ({
          description: text(item.description),
          amount: text(money(item.amount)),
        })),
      },
      invoice_no: text(invoice.invoiceNo),
      date: text(printedDate(invoice.date)),
      received_from: text(invoice.receivedFrom),
      student_name: text(invoice.studentName),
      total: text(money(sum)),
      amount_in_words: text(amountInWords(sum)),
      ...ticks(invoice.paymentMethod),
      remarks: text(
        invoice.remarks.kind === "some" ? invoice.remarks.text : "",
      ),
      received_by: text(invoice.receivedBy),
    },
  });
}
