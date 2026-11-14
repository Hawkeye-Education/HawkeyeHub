// Automatic review of one draft (spec #201, *Automatic review*): to fill in, ready or warned. The
// Import batch's review (blocked: fix on sheet, duplicates, skipped) wraps this per entry.

import type { HkdCents } from "./amountInWords";
import {
  CalendarDate,
  type InvoiceDraft,
  type InvoiceFields,
  type LineItem,
  type PaymentMethod,
} from "./invoice";

/** A form field a problem is shown on. Line-item fields carry the item's index. */
export type Field =
  | "date"
  | "receivedFrom"
  | "studentName"
  | "paymentMethod"
  | "paymentOtherText"
  | "receivedBy"
  | `item-description-${string}`
  | `item-amount-${string}`;

/** `required`: empty. `amount`: not a sum above 0. `date`: not a date. `future`: after today. */
export type Reason = "required" | "amount" | "date" | "future";

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
