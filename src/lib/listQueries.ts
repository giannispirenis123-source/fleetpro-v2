// src/lib/listQueries.ts
// Τα φίλτρα/αναζήτηση/ταξινόμηση των σελιδοποιημένων λιστών ως Prisma where —
// καθαρή λογική (χωρίς db), για server και tests. Η εταιρία (και η στεγανότητα
// του συνεργάτη) έρχεται ΠΑΝΤΑ από τον καλούντα (bookingScope / συνεδρία) και
// μπαίνει ΠΡΩΤΗ — κανένα φίλτρο από το URL δεν την αλλάζει.

import { searchWords, wordsWhere } from "./pagination";

const ci = (contains: string) => ({ contains, mode: "insensitive" as const });

/* ── Κρατήσεις ── */

export const BOOKING_FILTERS = ["ALL", "PENDING", "CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type BookingFilter = (typeof BOOKING_FILTERS)[number];
export const isBookingFilter = (v: unknown): v is BookingFilter =>
  typeof v === "string" && (BOOKING_FILTERS as readonly string[]).includes(v);

export function bookingListWhere(
  scope: { tenantId: string; partnerId?: string },
  f: { status?: unknown; q?: unknown; mineUserId?: string | null }
) {
  return {
    ...scope,
    ...(isBookingFilter(f.status) && f.status !== "ALL" ? { status: f.status } : {}),
    ...(f.mineUserId ? { createdById: f.mineUserId } : {}),
    ...wordsWhere(searchWords(f.q), (w) => [
      { bookingNumber: ci(w) },
      { customer: { firstName: ci(w) } },
      { customer: { lastName: ci(w) } },
      { vehicle: { brand: ci(w) } },
      { vehicle: { model: ci(w) } },
      { vehicle: { plate: ci(w) } },
    ]),
  };
}

/** Νεότερες πρώτα (όπως πριν), σταθερή σειρά με το id. Index: (tenantId, createdAt DESC). */
export const BOOKING_LIST_ORDER = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/* ── Πελάτες ── */

export function customerListWhere(tenantId: string, q: unknown) {
  return {
    tenantId,
    ...wordsWhere(searchWords(q), (w) => [
      { firstName: ci(w) },
      { lastName: ci(w) },
      { email: ci(w) },
      { phone: { contains: w } },
    ]),
  };
}

/** Αλφαβητικά (όπως πριν). Index: (tenantId, lastName, firstName, id) — SQL 32. */
export const CUSTOMER_LIST_ORDER = [{ lastName: "asc" as const }, { firstName: "asc" as const }, { id: "asc" as const }];

/* ── Τιμολόγια ── */

export const INVOICE_FILTERS = ["ALL", "UNPAID", "PAID", "OVERDUE"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

/**
 * Ίδιο νόημα με το effectiveStatus (invoices.ts): «Ληξιπρόθεσμο» = OVERDUE ή
 * απλήρωτο με προθεσμία πριν από σήμερα· «Απλήρωτα» = απλήρωτα + ληξιπρόθεσμα.
 * `today` = "YYYY-MM-DD" (ίδια ημέρα με το effectiveStatus).
 */
export function invoiceListWhere(tenantId: string, f: { filter?: unknown; q?: unknown; today: string }) {
  const startOfToday = new Date(`${f.today}T00:00:00.000Z`);
  const status =
    f.filter === "PAID"
      ? { status: "PAID" as const }
      : f.filter === "UNPAID"
        ? { status: { in: ["UNPAID" as const, "OVERDUE" as const] } }
        : f.filter === "OVERDUE"
          ? { OR: [{ status: "OVERDUE" as const }, { status: "UNPAID" as const, dueDate: { lt: startOfToday } }] }
          : {};
  return {
    tenantId,
    ...status,
    ...wordsWhere(searchWords(f.q), (w) => [
      { invoiceCode: ci(w) },
      { invoiceNumber: ci(w) },
      { customer: { firstName: ci(w) } },
      { customer: { lastName: ci(w) } },
      { booking: { bookingNumber: ci(w) } },
    ]),
  };
}

/** Νεότερα πρώτα (όπως πριν). Index: (tenantId, issueDate DESC) — SQL 32. */
export const INVOICE_LIST_ORDER = [{ issueDate: "desc" as const }, { id: "desc" as const }];
