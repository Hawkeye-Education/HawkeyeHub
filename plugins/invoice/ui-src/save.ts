// Writing Invoices into the save folder (spec #201, *Saving*): one `<Invoice No.>.docx` each,
// never over an existing file. Busy is the caller's, around the whole save.

import type { FolderPath } from "@hawkeye-hub/hub-api";
import { fillTemplate } from "./fill";
import { hubError, refused } from "./hub-error";
import {
  InvoiceNo,
  type CalendarDate,
  type Invoice,
  type InvoiceFields,
} from "./invoice";

export type WriteOutcome =
  | { readonly kind: "written" }
  /** A file by that name is already in the folder; nothing was written. */
  | { readonly kind: "exists" }
  /** The OS refused; `message` is its reason, in English. */
  | { readonly kind: "failed"; readonly message: string };

export const fileName = (invoiceNo: InvoiceNo): string => `${invoiceNo}.docx`;

/** Fills and writes one Invoice as `<Invoice No.>.docx`. */
export async function writeInvoice(
  folder: FolderPath,
  template: Uint8Array,
  invoice: Invoice,
): Promise<WriteOutcome> {
  const bytes = await fillTemplate(template, invoice);
  try {
    await window.hub.files.writeBytes(
      folder,
      fileName(invoice.invoiceNo),
      bytes,
    );
    return { kind: "written" };
  } catch (e) {
    const err = hubError(e);
    if (err.code === "exists") return { kind: "exists" };
    if (err.code === "write-failed")
      return { kind: "failed", message: err.message };
    return refused("hub.files.writeBytes", err);
  }
}

/** The highest NNNN an `INV-YYYYMMDD-NNNN` can have. */
const LAST = 9999;

/**
 * Saves a Fill-in Invoice as the first free `INV-<date>-NNNN`, re-filling the page with each
 * number tried, so two people saving at once never share one.
 */
export async function saveFillIn(
  folder: FolderPath,
  template: Uint8Array,
  fields: InvoiceFields,
): Promise<
  | { readonly kind: "written"; readonly invoiceNo: InvoiceNo }
  | {
      readonly kind: "failed";
      readonly invoiceNo: InvoiceNo;
      readonly message: string;
    }
> {
  // ponytail: linear probe from 0001, fine at a few Fill-in Invoices a day.
  for (let n = 1; n <= LAST; n++) {
    const invoiceNo = fillInNo(fields.date, n);
    const outcome = await writeInvoice(folder, template, {
      ...fields,
      invoiceNo,
    });
    switch (outcome.kind) {
      case "written":
        return { kind: "written", invoiceNo };
      case "failed":
        return { kind: "failed", invoiceNo, message: outcome.message };
      case "exists":
        continue;
      default:
        outcome satisfies never;
    }
  }
  throw new Error(`every INV number for ${fields.date} is taken`);
}

function fillInNo(date: CalendarDate, n: number): InvoiceNo {
  return InvoiceNo.parse(
    `INV-${date.replace(/-/g, "")}-${String(n).padStart(4, "0")}`,
  );
}
