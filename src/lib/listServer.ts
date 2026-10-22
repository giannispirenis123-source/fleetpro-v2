// src/lib/listServer.ts
// Οι σελιδοποιημένες λίστες του dashboard (κρατήσεις, πελάτες, τιμολόγια) —
// ΜΟΝΟ server. Ίδιο αποτέλεσμα για την πρώτη φόρτωση της σελίδας και για το
// API (αλλαγή σελίδας / φίλτρου / αναζήτησης). Εταιρία και στεγανότητα από
// τη συνεδρία (bookingScope / tenantId), ποτέ από το URL.

import { db } from "./db";
import { bookingScope, type Viewer } from "./authz";
import { BOOKING_PAYMENT_INCLUDE, toBookingDTO, type BookingDTO } from "./bookings";
import { summarize, type CommissionSettings, type CommissionSummary } from "./commission";
import { toCustomerDTO, type CustomerDTO } from "./customers";
import { INVOICE_RELATIONS, toInvoiceDTO, type InvoiceDTO } from "./invoices";
import { LIST_PAGE_SIZE, pageWindow, parsePage, type ListPage } from "./pagination";
import {
  BOOKING_LIST_ORDER,
  CUSTOMER_LIST_ORDER,
  INVOICE_LIST_ORDER,
  bookingListWhere,
  customerListWhere,
  invoiceListWhere,
} from "./listQueries";

/* ─────────────────────────────────────────────
   Κρατήσεις
   ───────────────────────────────────────────── */

export const BOOKING_LIST_INCLUDE = {
  vehicle: { select: { brand: true, model: true, plate: true } },
  customer: { select: { firstName: true, lastName: true } },
  invoice: { select: { invoiceNumber: true, invoiceCode: true } },
  partner: {
    select: {
      id: true,
      name: true,
      commissionRate: true,
      commissionOnRental: true,
      commissionOnExtras: true,
      commissionOnInsurance: true,
    },
  },
  createdBy: { select: { id: true, name: true } },
  messages: { select: { kind: true, channel: true, result: true } },
  payments: BOOKING_PAYMENT_INCLUDE,
} as const;

export interface BookingListPage extends ListPage<BookingDTO> {
  /** Η σύνοψη προμήθειας του χρήστη σε ΟΛΕΣ τις κρατήσεις του (όχι μόνο της σελίδας). */
  commission: { all: CommissionSummary; month: CommissionSummary } | null;
}

export interface BookingListFilters {
  status?: unknown;
  q?: unknown;
  mine?: boolean;
  page?: unknown;
}

/**
 * Σύνοψη προμήθειας στον server, πάνω σε ΟΛΕΣ τις κρατήσεις που αφορούν τον
 * χρήστη: ο συνεργάτης όσες ΕΦΕΡΕ, το προσωπικό όσες ΚΑΤΑΧΩΡΗΣΕ (ίδιος κανόνας
 * με πριν). Μόνο τα ποσά — καμία άλλη στήλη.
 */
export async function loadCommissionSummary(viewer: Viewer, settings: CommissionSettings, now = new Date()) {
  if (!viewer.tenantId || settings.rate <= 0) return null;
  const who = viewer.role === "PARTNER" ? { partnerId: viewer.userId } : { createdById: viewer.userId };
  const rows = await db.booking.findMany({
    where: { tenantId: viewer.tenantId, ...who },
    select: { status: true, pickupDate: true, subtotal: true, extrasTotal: true, insuranceCost: true },
  });
  const parts = rows.map((r) => ({
    status: r.status,
    pickupDate: r.pickupDate.toISOString().slice(0, 10),
    subtotal: Number(r.subtotal),
    extrasTotal: Number(r.extrasTotal),
    insuranceCost: Number(r.insuranceCost),
  }));
  const month = now.toISOString().slice(0, 7);
  return { all: summarize(parts, settings), month: summarize(parts.filter((p) => p.pickupDate.startsWith(month)), settings) };
}

export async function loadBookingPage(
  viewer: Viewer,
  f: BookingListFilters,
  commission?: CommissionSettings | null
): Promise<BookingListPage> {
  const where = bookingListWhere(bookingScope(viewer), { status: f.status, q: f.q, mineUserId: f.mine ? viewer.userId : null });
  const page = parsePage(f.page);
  const { skip, take } = pageWindow(page, LIST_PAGE_SIZE);
  const [total, rows, summary] = await Promise.all([
    db.booking.count({ where }),
    db.booking.findMany({ where, orderBy: BOOKING_LIST_ORDER, skip, take, include: BOOKING_LIST_INCLUDE }),
    commission ? loadCommissionSummary(viewer, commission) : null,
  ]);
  return { items: rows.map(toBookingDTO), total, page, pageSize: take, commission: summary };
}

/** Μία κράτηση (π.χ. από το Ημερολόγιο ?booking=…) — ίδια στεγανότητα. */
export async function loadBookingForList(viewer: Viewer, id: string): Promise<BookingDTO | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const row = await db.booking.findFirst({ where: { ...bookingScope(viewer), id }, include: BOOKING_LIST_INCLUDE });
  return row ? toBookingDTO(row) : null;
}

/* ─────────────────────────────────────────────
   Πελάτες
   ───────────────────────────────────────────── */

export async function loadCustomerPage(tenantId: string, f: { q?: unknown; page?: unknown }): Promise<ListPage<CustomerDTO>> {
  const where = customerListWhere(tenantId, f.q);
  const page = parsePage(f.page);
  const { skip, take } = pageWindow(page, LIST_PAGE_SIZE);
  const [total, rows] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({ where, orderBy: CUSTOMER_LIST_ORDER, skip, take, include: { _count: { select: { bookings: true } } } }),
  ]);
  return { items: rows.map(toCustomerDTO), total, page, pageSize: take };
}

/* ─────────────────────────────────────────────
   Τιμολόγια
   ───────────────────────────────────────────── */

export async function loadInvoicePage(tenantId: string, f: { filter?: unknown; q?: unknown; page?: unknown }): Promise<ListPage<InvoiceDTO>> {
  const where = invoiceListWhere(tenantId, { filter: f.filter, q: f.q, today: new Date().toISOString().slice(0, 10) });
  const page = parsePage(f.page);
  const { skip, take } = pageWindow(page, LIST_PAGE_SIZE);
  const [total, rows] = await Promise.all([
    db.invoice.count({ where }),
    db.invoice.findMany({ where, orderBy: INVOICE_LIST_ORDER, skip, take, include: INVOICE_RELATIONS }),
  ]);
  return { items: rows.map(toInvoiceDTO), total, page, pageSize: take };
}

/** Οι ρυθμίσεις προμήθειας του ΙΔΙΟΥ του χρήστη (null = καμία σύνοψη). */
export async function myCommissionSettings(viewer: Viewer, canSee: boolean): Promise<CommissionSettings | null> {
  if (!canSee) return null;
  const me = await db.user.findUnique({
    where: { id: viewer.userId },
    select: { commissionRate: true, commissionOnRental: true, commissionOnExtras: true, commissionOnInsurance: true },
  });
  const rate = Number(me?.commissionRate ?? 0);
  return rate > 0
    ? { rate, onRental: me?.commissionOnRental ?? true, onExtras: me?.commissionOnExtras ?? false, onInsurance: me?.commissionOnInsurance ?? false }
    : null;
}
