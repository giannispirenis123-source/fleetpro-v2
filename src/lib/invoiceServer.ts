// src/lib/invoiceServer.ts
// Server-only: φόρτωση τιμολογίου για PDF/email, εξασφάλιση κωδικού και
// λογότυπο εταιρίας. Το tenantId έρχεται ΠΑΝΤΑ από τη συνεδρία.

import { db } from "./db";
import { signUrls } from "./storage";
import { readExtrasSnapshot } from "./pricing";
import { manualRentalOf, readPriceOverride, type PriceParts } from "./priceOverride";
import { effectiveStatus } from "./invoices";
import { withInvoiceCode } from "./invoiceCode";
import { invoiceLines, type InvoiceDoc } from "./invoiceDocument";

const INCLUDE = {
  tenant: {
    select: {
      name: true,
      vat: true,
      taxOffice: true,
      address: true,
      region: true,
      phone: true,
      email: true,
      iban: true,
      brandColor: true,
      logoPath: true,
    },
  },
  customer: {
    select: { firstName: true, lastName: true, email: true, phone: true, address: true, city: true },
  },
  booking: {
    select: {
      bookingNumber: true,
      pickupDate: true,
      pickupTime: true,
      returnDate: true,
      returnTime: true,
      totalDays: true,
      dailyRate: true,
      subtotal: true,
      extrasTotal: true,
      insuranceCost: true,
      discountAmount: true,
      discountCode: true,
      total: true,
      extras: true,
      vehicle: { select: { brand: true, model: true, plate: true } },
      contract: { select: { snapshot: true } },
    },
  },
} as const;

/**
 * Δίνει κωδικό σε τιμολόγιο που δεν έχει (π.χ. το έβγαλε η παλιά έκδοση
 * αφού έτρεξε το SQL 19). Ο κωδικός βγαίνει ΜΟΝΟ από το invoiceCode.ts.
 */
export async function ensureInvoiceCode(id: string, current: string | null): Promise<string> {
  if (current) return current;
  await withInvoiceCode((invoiceCode) =>
    db.invoice.updateMany({ where: { id, invoiceCode: null }, data: { invoiceCode } })
  );
  const row = await db.invoice.findUnique({ where: { id }, select: { invoiceCode: true } });
  return row!.invoiceCode!;
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Το τιμολόγιο ως έγγραφο, ή null αν δεν ανήκει στην εταιρία. */
export async function loadInvoiceDoc(tenantId: string, id: string) {
  const inv = await db.invoice.findFirst({ where: { id, tenantId }, include: INCLUDE });
  if (!inv) return null;

  const code = await ensureInvoiceCode(inv.id, inv.invoiceCode);
  const b = inv.booking;
  const parts: PriceParts = {
    subtotal: Number(b.subtotal),
    extrasTotal: Number(b.extrasTotal),
    insuranceCost: Number(b.insuranceCost),
    discountAmount: Number(b.discountAmount),
  };

  // Χειροκίνητο ενοίκιο συμβολαίου: ίδια ανάλυση με το Α4/PDF συμβολαίου.
  const snapshot = (b.contract?.snapshot ?? null) as { priceOverride?: unknown; booking?: PriceParts } | null;
  const override = readPriceOverride(snapshot?.priceOverride);
  const manualRental = override ? manualRentalOf(override, snapshot?.booking ?? parts) : undefined;

  const total = Number(inv.total);
  const doc: InvoiceDoc = {
    code,
    issueDate: ymd(inv.issueDate)!,
    dueDate: ymd(inv.dueDate)!,
    paidAt: ymd(inv.paidAt),
    status: effectiveStatus({ status: inv.status, dueDate: ymd(inv.dueDate)! }),
    company: {
      name: inv.tenant.name,
      vat: inv.tenant.vat,
      taxOffice: inv.tenant.taxOffice,
      address: inv.tenant.address,
      region: inv.tenant.region,
      phone: inv.tenant.phone,
      email: inv.tenant.email,
      iban: inv.tenant.iban,
      brandColor: inv.tenant.brandColor,
    },
    customer: {
      name: `${inv.customer.firstName} ${inv.customer.lastName}`.trim(),
      address: [inv.customer.address, inv.customer.city].filter(Boolean).join(", ") || null,
      phone: inv.customer.phone,
      email: inv.customer.email,
    },
    booking: {
      number: b.bookingNumber,
      vehicle: `${b.vehicle.brand} ${b.vehicle.model}`.trim(),
      plate: b.vehicle.plate,
      pickupDate: ymd(b.pickupDate)!,
      pickupTime: b.pickupTime,
      returnDate: ymd(b.returnDate)!,
      returnTime: b.returnTime,
    },
    lines: invoiceLines(
      {
        ...parts,
        totalDays: b.totalDays,
        dailyRate: Number(b.dailyRate),
        discountCode: b.discountCode,
        total: Number(b.total),
        extras: readExtrasSnapshot(b.extras),
      },
      total,
      manualRental
    ),
    // ΑΠΟΘΗΚΕΥΜΕΝΑ ποσά — όχι επανυπολογισμός.
    net: Number(inv.subtotal),
    vatRate: Number(inv.taxRate),
    vatAmount: Number(inv.taxAmount),
    total,
  };

  return { doc, customerEmail: inv.customer.email, logoPath: inv.tenant.logoPath };
}

const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Το λογότυπο (ιδιωτικό Storage) ως bytes, για το PDF. Οποιαδήποτε αποτυχία
 * → null: το PDF βγαίνει απλώς με την επωνυμία. Δεν γράφεται URL στα logs.
 */
export async function fetchLogoBytes(logoPath: string | null): Promise<Uint8Array | null> {
  if (!logoPath) return null;
  try {
    const url = (await signUrls([logoPath], 120)).get(logoPath);
    if (!url) return null;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error(`[FleetPro] λογότυπο τιμολογίου: HTTP ${res.status}`);
      return null;
    }
    if (Number(res.headers.get("content-length") ?? 0) > LOGO_MAX_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > 0 && buf.length <= LOGO_MAX_BYTES ? buf : null;
  } catch (e) {
    console.error("[FleetPro] λογότυπο τιμολογίου:", e instanceof Error ? e.name : "σφάλμα");
    return null;
  }
}
