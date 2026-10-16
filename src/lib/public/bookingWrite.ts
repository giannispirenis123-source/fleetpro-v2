// src/lib/public/bookingWrite.ts
// Η ΕΓΓΡΑΦΗ μιας κράτησης του site μέσα στην transaction (ήδη με κλείδωμα).
// Χωρίς import της βάσης: το tx και οι βοηθοί δίνονται από τον καλούντα
// (bookingSubmit.ts) — έτσι ελέγχεται στα tests με ψεύτικο tx.
//
// · Πελάτης: ΥΠΑΡΧΩΝ με ίδιο email στην ίδια εταιρία → χρησιμοποιείται ΩΣ ΕΧΕΙ
//   (καμία αντικατάσταση στοιχείων)· αλλιώς νέος ΜΟΝΟ με όσα έδωσε.
// · Κράτηση: PENDING, source "site", όχημα της ομάδας (ανατέθηκε αυτόματα),
//   ομάδα, ολόκληρη η ανάλυση της quote() (priceQuote, AUTO), πτήση, σχόλια.
// · Κωδικός: τυχαίος, μοναδικός σε όλη τη βάση (UNIQUE)· σε σύγκρουση νέος.
// · Ειδοποίηση «Νέα κράτηση από το site» στο dashboard (όχι email).

import { buildExtrasSnapshot } from "../pricing";
import { SITE_BOOKING_STATUS, type CleanContact } from "./bookingRequest";
import type { SitePlan } from "./bookingPlan";

export interface SiteBookingTx {
  customer: { findFirst(args: any): Promise<{ id: string } | null>; create(args: any): Promise<{ id: string }> };
  booking: { findUnique(args: any): Promise<{ id: string } | null>; create(args: any): Promise<{ id: string }> };
  notification: { create(args: any): Promise<unknown> };
}

export interface SiteBookingWrite {
  tenantId: string;
  plan: SitePlan;
  contact: CleanContact;
  locations: { pickup: string | null; dropoff: string | null };
  window: { from: string; to: string };
  /** Η γλώσσα του site στην υποβολή — για τα μηνύματα προς τον πελάτη. */
  lang?: string;
}

const toDate = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00.000Z`);

export async function writeSiteBooking<Tx extends SiteBookingTx>(
  tx: Tx,
  w: SiteBookingWrite,
  deps: { nextNumber: (tx: Tx) => Promise<string>; generateCode: () => string }
): Promise<string> {
  const { tenantId, plan, contact } = w;

  const existing = await tx.customer.findFirst({
    where: { tenantId, email: { equals: contact.email, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const customerId =
    existing?.id ??
    (
      await tx.customer.create({
        data: {
          tenantId,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          dateOfBirth: toDate(contact.birthDate),
        },
        select: { id: true },
      })
    ).id;

  let code = "";
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const candidate = deps.generateCode();
    const clash = await tx.booking.findUnique({ where: { publicCode: candidate }, select: { id: true } });
    if (!clash) code = candidate;
  }
  if (!code) throw new Error("booking code");

  const b = plan.breakdown;
  const booking = await tx.booking.create({
    data: {
      tenantId,
      customerId,
      vehicleId: plan.vehicleId,
      rentalGroupId: plan.rentalGroupId,
      bookingNumber: await deps.nextNumber(tx),
      publicCode: code,
      status: SITE_BOOKING_STATUS,
      source: "site",
      pickupDate: toDate(w.window.from),
      pickupTime: w.window.from.slice(11, 16),
      returnDate: toDate(w.window.to),
      returnTime: w.window.to.slice(11, 16),
      pickupLocation: w.locations.pickup,
      returnLocation: w.locations.dropoff ?? w.locations.pickup,
      dailyRate: b.dailyRate,
      totalDays: b.totalDays,
      subtotal: b.subtotal,
      extrasTotal: b.extrasTotal,
      insuranceCost: b.insuranceCost,
      discountAmount: b.discountAmount,
      total: b.total,
      extras: buildExtrasSnapshot(b.lines),
      priceQuote: plan.stored,
      priceMode: "AUTO",
      flightNumber: contact.flightNumber,
      notes: contact.notes,
      siteLang: w.lang ?? null,
    },
    select: { id: true },
  });

  await tx.notification.create({
    data: {
      tenantId,
      type: "BOOKING_NEW",
      title: "Νέα κράτηση από το site",
      message: `${code} · ${contact.firstName} ${contact.lastName}`.slice(0, 200),
      link: `/dashboard/bookings?status=PENDING&booking=${booking.id}`,
    },
  });
  return code;
}
