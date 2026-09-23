// src/lib/invoices.ts
// Τιμολόγια — κοινό σημείο για API, σελίδα και εκτύπωση.
// Δεν εισάγει Prisma runtime ώστε να μπορεί να φορτωθεί από client component.

import type { Invoice } from "@prisma/client";
import { round2 } from "./pricing";

export const INVOICE_STATUSES = ["UNPAID", "PAID", "OVERDUE", "CANCELLED"] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];

export const INVOICE_ISSUE_TRIGGERS = ["ON_COMPLETION", "ON_CONTRACT"] as const;
export const INVOICE_SEND_MODES = ["AUTO", "MANUAL"] as const;

/** Χρώμα pill ανά κατάσταση — κλάσεις που υπάρχουν ήδη στο dashboard.css. */
export const INVOICE_STATUS_CLASS: Record<string, string> = {
  PAID: "ok",
  UNPAID: "warn",
  OVERDUE: "bad",
  CANCELLED: "muted",
};

/** Προθεσμία πληρωμής σε ημέρες από την έκδοση. */
export const DUE_DAYS = 30;

/* ─────────────────────────────────────────────
   ΦΠΑ — οι τιμές ΠΕΡΙΕΧΟΥΝ ΦΠΑ
   ───────────────────────────────────────────── */

export interface VatSplit {
  /** Καθαρή αξία, χωρίς ΦΠΑ. */
  net: number;
  vatRate: number;
  vatAmount: number;
  /** Ίδιο με το ποσό της κράτησης — δεν προστίθεται ΦΠΑ από πάνω. */
  total: number;
}

/**
 * Σπάει ένα ποσό που ΗΔΗ περιέχει ΦΠΑ σε καθαρή αξία και ΦΠΑ.
 *
 *   net = total / (1 + ΦΠΑ%/100)     61 / 1,24 = 49,19
 *   ΦΠΑ = total − net                61 − 49,19 = 11,81
 *
 * Το ΦΠΑ βγαίνει ως αφαίρεση και όχι με δικό του πολλαπλασιασμό, ώστε
 * net + ΦΠΑ να ισούται ΠΑΝΤΑ ακριβώς με το σύνολο, χωρίς χαμένο λεπτό.
 */
export function splitVatInclusive(total: number, vatRate: number): VatSplit {
  const rate = Math.max(0, vatRate);
  const gross = round2(Math.max(0, total));
  const net = round2(gross / (1 + rate / 100));

  return {
    net,
    vatRate: rate,
    vatAmount: round2(gross - net),
    total: gross,
  };
}

/* ─────────────────────────────────────────────
   DTO
   ───────────────────────────────────────────── */

export interface InvoiceDTO {
  id: string;
  invoiceNumber: string;
  status: string;

  bookingId: string;
  bookingNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  customerAddress: string | null;

  /** "YYYY-MM-DD" — έτοιμο για εμφάνιση και <input type="date">. */
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  sentAt: string | null;

  /** Καθαρή αξία. Στη βάση λέγεται subtotal. */
  net: number;
  /** Ποσοστό ΦΠΑ όπως ίσχυε ΤΗ ΣΤΙΓΜΗ της έκδοσης (snapshot). */
  vatRate: number;
  vatAmount: number;
  total: number;

  notes: string | null;
  createdAt: string;
}

/**
 * Ό,τι χρειάζεται το toInvoiceDTO — σε ΕΝΑ σημείο, ώστε καμία διαδρομή να
 * μη φέρει κατά λάθος λιγότερα απ' όσα διαβάζει η μετατροπή.
 */
export const INVOICE_RELATIONS = {
  booking: { select: { bookingNumber: true } },
  customer: {
    select: {
      firstName: true,
      lastName: true,
      email: true,
      address: true,
      city: true,
    },
  },
} as const;

type InvoiceWithRelations = Invoice & {
  booking: { bookingNumber: string };
  customer: {
    firstName: string;
    lastName: string;
    email: string | null;
    address: string | null;
    city: string | null;
  };
};

const toDateInput = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

export function toInvoiceDTO(i: InvoiceWithRelations): InvoiceDTO {
  const address = [i.customer.address, i.customer.city]
    .filter(Boolean)
    .join(", ");

  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    status: i.status,

    bookingId: i.bookingId,
    bookingNumber: i.booking.bookingNumber,
    customerId: i.customerId,
    customerName: `${i.customer.firstName} ${i.customer.lastName}`,
    customerEmail: i.customer.email,
    customerAddress: address || null,

    issueDate: toDateInput(i.issueDate)!,
    dueDate: toDateInput(i.dueDate)!,
    paidAt: toDateInput(i.paidAt),
    sentAt: i.sentAt ? i.sentAt.toISOString() : null,

    net: Number(i.subtotal),
    vatRate: Number(i.taxRate),
    vatAmount: Number(i.taxAmount),
    total: Number(i.total),

    notes: i.notes,
    createdAt: i.createdAt.toISOString(),
  };
}

/**
 * Ένα απλήρωτο τιμολόγιο που πέρασε η προθεσμία του εμφανίζεται ως
 * ληξιπρόθεσμο, χωρίς να χρειάζεται εργασία που να αλλάζει τη βάση.
 */
export function effectiveStatus(
  i: Pick<InvoiceDTO, "status" | "dueDate">,
  today: string = new Date().toISOString().slice(0, 10)
): string {
  if (i.status === "UNPAID" && i.dueDate < today) return "OVERDUE";
  return i.status;
}
