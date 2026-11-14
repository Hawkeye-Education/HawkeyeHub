// Automatic review of one draft (spec #201, *Automatic review*): to fill in, ready or warned. The
// Import batch's review (blocked: fix on sheet, duplicates, skipped) wraps this per entry.

import type { HkdCents } from "./amountInWords";
import { money } from "./fill";
import type { SheetRow } from "./google";
import {
  CalendarDate,
  InvoiceNo,
  type Invoice,
  type InvoiceDraft,
  type InvoiceFields,
  type LineItem,
  type PaymentMethod,
} from "./invoice";

/** A form field a problem is shown on. Line-item fields carry the item's index. */
export type Field =
  | "invoiceNo"
  | "date"
  | "receivedFrom"
  | "studentName"
  | "paymentMethod"
  | "paymentOtherText"
  | "receivedBy"
  | `item-description-${string}`
  | `item-amount-${string}`;

/**
 * `required`: empty. `amount`: not a sum above 0. `date`: not a date. `future`: after today.
 * `sheet-*`: a blocked Import entry's BlockReason, shown on the read-only field it concerns.
 */
export type Reason =
  "required" | "amount" | "date" | "future" | `sheet-${BlockReason["kind"]}`;

export interface Problem {
  readonly field: Field;
  readonly reason: Reason;
}

export type Review =
  | { readonly kind: "to-fill-in"; readonly problems: readonly Problem[] }
  | { readonly kind: "ready"; readonly invoice: InvoiceFields }
  /** Saveable; `problems` holds the warning, a date after today. */
  | {
      readonly kind: "warned";
      readonly invoice: InvoiceFields;
      readonly problems: readonly Problem[];
    };

/** A typed amount as cents above 0: `1234`, `1,234.5`, `1234.50`. */
export function parseAmount(text: string): HkdCents | "invalid" {
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) return "invalid";
  const dollars = Number((match[1] ?? "").replace(/,/g, ""));
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const amount = dollars * 100 + cents;
  // Whole non-negative cents by the pattern above.
  return amount > 0 && Number.isSafeInteger(amount)
    ? (amount as HkdCents)
    : "invalid";
}

export function review(draft: InvoiceDraft, on: CalendarDate): Review {
  const problems: Problem[] = [];
  const required = (field: Field, value: string): string => {
    const trimmed = value.trim();
    if (trimmed === "") problems.push({ field, reason: "required" });
    return trimmed;
  };

  const date = CalendarDate.safeParse(draft.date);
  if (!date.success) problems.push({ field: "date", reason: "date" });
  const receivedFrom = required("receivedFrom", draft.receivedFrom);
  const studentName = required("studentName", draft.studentName);
  const lineItems: LineItem[] = [];
  draft.lineItems.forEach((item, i) => {
    const description = required(
      `item-description-${String(i)}`,
      item.description,
    );
    const amount = parseAmount(item.amount);
    if (amount === "invalid")
      problems.push({ field: `item-amount-${String(i)}`, reason: "amount" });
    else lineItems.push({ description, amount });
  });
  let paymentMethod: PaymentMethod | "none" = "none";
  switch (draft.paymentMethod.kind) {
    case "none":
      problems.push({ field: "paymentMethod", reason: "required" });
      break;
    case "other":
      paymentMethod = {
        kind: "other",
        text: required("paymentOtherText", draft.paymentMethod.text),
      };
      break;
    case "cash":
    case "bank-transfer":
    case "fps":
    case "cheque":
      paymentMethod = { kind: draft.paymentMethod.kind };
      break;
    default:
      draft.paymentMethod satisfies never;
  }
  const receivedBy = required("receivedBy", draft.receivedBy);

  const [first, ...rest] = lineItems;
  if (
    problems.length > 0 ||
    !date.success ||
    first === undefined ||
    paymentMethod === "none"
  )
    return { kind: "to-fill-in", problems };
  const remarks = draft.remarks.trim();
  const invoice: InvoiceFields = {
    date: date.data,
    receivedFrom,
    studentName,
    lineItems: [first, ...rest],
    paymentMethod,
    remarks:
      remarks === "" ? { kind: "none" } : { kind: "some", text: remarks },
    receivedBy,
  };
  // ISO dates compare as strings.
  return invoice.date > on
    ? {
        kind: "warned",
        invoice,
        problems: [{ field: "date", reason: "future" }],
      }
    : { kind: "ready", invoice };
}

// --- The Import batch ---------------------------------------------------------------------------

/** An Import batch entry: the Invoice's draft as staff type it, and the sheet row it came from. */
export interface ImportEntry {
  readonly draft: InvoiceDraft;
  readonly sourceRow: SheetRow;
  readonly skipped: boolean;
}

/** A sheet row's entry: its date and amount locked in, its description to word for the parent. */
export function importEntry(row: SheetRow, receivedBy: string): ImportEntry {
  return {
    draft: {
      date: row.date === "unreadable" ? "" : row.date,
      receivedFrom: "",
      studentName: "",
      lineItems: [
        {
          description: row.description,
          amount: row.amount === "unreadable" ? "" : money(row.amount),
        },
      ],
      paymentMethod: { kind: "none" },
      remarks: "", // never copied from the sheet: Remarks reach the parent
      receivedBy,
    },
    sourceRow: row,
    skipped: false,
  };
}

/** Why an imported Invoice can only be fixed on the Cash Flow Sheet. */
export type BlockReason =
  | { readonly kind: "transactionId" }
  /** Every row sharing the Transaction ID, by Item No. */
  | { readonly kind: "duplicate"; readonly itemNos: readonly string[] }
  | { readonly kind: "amount" }
  | { readonly kind: "date" };

/** Each of a blocked entry's reasons, flagged on the read-only field it concerns. */
export function sheetProblems(reasons: readonly BlockReason[]): Problem[] {
  return reasons.map((reason) => {
    switch (reason.kind) {
      case "transactionId":
      case "duplicate":
        return { field: "invoiceNo", reason: `sheet-${reason.kind}` };
      case "amount":
        // An imported Invoice has the one line item its sheet row holds.
        return { field: "item-amount-0", reason: "sheet-amount" };
      case "date":
        return { field: "date", reason: "sheet-date" };
      default:
        return reason satisfies never;
    }
  });
}

/** An entry's status. Ready and warned carry the Invoice Save writes. */
export type EntryStatus =
  | { readonly kind: "blocked"; readonly reasons: readonly BlockReason[] }
  | { readonly kind: "skipped" }
  | { readonly kind: "to-fill-in"; readonly problems: readonly Problem[] }
  | { readonly kind: "ready"; readonly invoice: Invoice }
  | {
      readonly kind: "warned";
      readonly invoice: Invoice;
      readonly problems: readonly Problem[];
    };

/** Each entry's status, in order. Duplicates are found across the whole batch. */
export function reviewBatch(
  entries: readonly ImportEntry[],
  on: CalendarDate,
): EntryStatus[] {
  return entries.map(({ draft, sourceRow: row, skipped }) => {
    if (skipped) return { kind: "skipped" };
    const reasons: BlockReason[] = [];
    const match = /^TXN-(\d{8})-\d{4}$/.exec(row.transactionId);
    const invoiceNo = InvoiceNo.safeParse(row.transactionId);
    if (
      match === null ||
      !invoiceNo.success ||
      (row.date !== "unreadable" && match[1] !== row.date.replace(/-/g, ""))
    )
      reasons.push({ kind: "transactionId" });
    const sharing = entries.filter(
      (e) => e.sourceRow.transactionId === row.transactionId,
    );
    if (sharing.length > 1)
      reasons.push({
        kind: "duplicate",
        itemNos: sharing.map((e) => e.sourceRow.itemNo),
      });
    if (row.amount === "unreadable") reasons.push({ kind: "amount" });
    if (row.date === "unreadable") reasons.push({ kind: "date" });
    if (reasons.length > 0 || !invoiceNo.success)
      return { kind: "blocked", reasons };

    const reviewed = review(draft, on);
    switch (reviewed.kind) {
      case "to-fill-in":
        return reviewed;
      case "ready":
        return {
          kind: "ready",
          invoice: { ...reviewed.invoice, invoiceNo: invoiceNo.data },
        };
      case "warned":
        return {
          ...reviewed,
          invoice: { ...reviewed.invoice, invoiceNo: invoiceNo.data },
        };
      default:
        return reviewed satisfies never;
    }
  });
}
