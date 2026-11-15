// The Invoice model (spec #201): an Invoice holds only what gets printed. A form still being typed
// is a draft, every field as staff typed it; review.ts turns a draft into an Invoice's fields once
// every rule passes. Total and Amount in words are computed, never stored.

import { z } from "zod";
import type { HkdCents } from "./amountInWords";

/** An Invoice No.: an imported row's Transaction ID, or a Fill-in Invoice's number from Save. */
export const InvoiceNo = z
  .string()
  .regex(/^(TXN|INV)-\d{8}-\d{4}$/)
  .brand<"InvoiceNo">();
export type InvoiceNo = z.infer<typeof InvoiceNo>;

/** The number an Invoice being edited shows. */
export type Numbering =
  | { readonly kind: "assigned"; readonly invoiceNo: InvoiceNo }
  /** A Fill-in Invoice: Save assigns its number. */
  | { readonly kind: "on-save" }
  /** A blocked row's Transaction ID, as the sheet has it, that isn't a valid Invoice No. */
  | { readonly kind: "invalid"; readonly transactionId: string };

/** A calendar date as `<input type=date>` holds it: `YYYY-MM-DD`. */
export const CalendarDate = z.iso.date().brand<"CalendarDate">();
export type CalendarDate = z.infer<typeof CalendarDate>;

/** Today's date on this computer's clock. */
export function today(): CalendarDate {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return CalendarDate.parse(
    `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  );
}

export type PaymentKind = "cash" | "bank-transfer" | "fps" | "cheque";
export const PAYMENT_KINDS: readonly PaymentKind[] = [
  "cash",
  "bank-transfer",
  "fps",
  "cheque",
];

export type PaymentMethod =
  | { readonly kind: PaymentKind }
  | { readonly kind: "other"; readonly text: string };

export interface LineItem {
  readonly description: string;
  readonly amount: HkdCents;
}

/** Everything an Invoice prints but its number, which a Fill-in Invoice only gets on Save. */
export interface InvoiceFields {
  readonly date: CalendarDate;
  readonly receivedFrom: string;
  readonly studentName: string;
  readonly lineItems: readonly [LineItem, ...LineItem[]];
  readonly paymentMethod: PaymentMethod;
  /** No remarks is a real state: most Invoices have none. */
  readonly remarks:
    | { readonly kind: "none" }
    | { readonly kind: "some"; readonly text: string };
  readonly receivedBy: string;
}

export interface Invoice extends InvoiceFields {
  readonly invoiceNo: InvoiceNo;
}

export function total(amounts: readonly HkdCents[]): HkdCents {
  // A sum of whole non-negative cents is one too.
  return amounts.reduce((sum, amount) => sum + amount, 0) as HkdCents;
}

/** A form as staff typed it: any field may be empty or not yet valid. */
export interface InvoiceDraft {
  readonly date: string;
  readonly receivedFrom: string;
  readonly studentName: string;
  readonly lineItems: readonly DraftLineItem[];
  readonly paymentMethod: { readonly kind: "none" } | PaymentMethod;
  readonly remarks: string;
  readonly receivedBy: string;
}

export interface DraftLineItem {
  readonly description: string;
  readonly amount: string;
}

/** A blank Fill-in draft dated `date`, with one empty line item and nothing pre-selected. */
export function blankDraft(
  date: CalendarDate,
  receivedBy: string,
): InvoiceDraft {
  return {
    date,
    receivedFrom: "",
    studentName: "",
    lineItems: [{ description: "", amount: "" }],
    paymentMethod: { kind: "none" },
    remarks: "",
    receivedBy,
  };
}
