// src/lib/public/bookingLookup.ts
// Η σελίδα επιβεβαίωσης — ΜΟΝΟ server. Η κράτηση βρίσκεται ΜΟΝΟ με τον κωδικό
// ΚΑΙ μέσα στην εταιρία του slug: κωδικός άλλης εταιρίας = null (404).
// Η τιμή από το ΑΠΟΘΗΚΕΥΜΕΝΟ priceQuote — κανένας νέος υπολογισμός.

import { db } from "../db";
import { readVehiclePhotos } from "../vehiclePhotos";
import { normalizeBookingCode, toConfirmationDTO, type ConfirmationDTO } from "./bookingRequest";
import { similarModelName } from "./catalog";
import { readLocalized, textFor } from "./text";
import { checkBookingPayment, expireStaleHolds } from "./paymentServer";
import { isCheckable } from "./payments";

export async function loadConfirmation(
  companyId: string,
  rawCode: string,
  lang: string,
  /** Επιστροφή από το Stripe (?paid=1): ρωτά το Stripe και για ληγμένη/αποτυχημένη. */
  justPaid = false
): Promise<ConfirmationDTO | null> {
  const code = normalizeBookingCode(rawCode);
  if (!code) return null;
  // Εφεδρικά, χωρίς webhook: όσο περιμένει πληρωμή (ή μόλις γύρισε από το
  // Stripe) ο server ρωτά το Stripe — με όριο 1/10΄΄ και την ΙΔΙΑ μετάβαση με το webhook.
  const head = await db.booking.findFirst({
    where: { publicCode: code, tenantId: companyId },
    select: { id: true, paymentMethod: true, paymentStatus: true },
  });
  if (head && isCheckable(head) && (head.paymentStatus === "AWAITING_PAYMENT" || justPaid)) {
    await checkBookingPayment(companyId, head.id);
  }
  // Αναμονή πληρωμής που έληξε χωρίς webhook → «δεν ολοκληρώθηκε» (και ακυρωμένη).
  await expireStaleHolds(db, companyId);
  const b = await db.booking.findFirst({
    where: { publicCode: code, tenantId: companyId },
    select: {
      publicCode: true,
      status: true,
      pickupDate: true,
      pickupTime: true,
      returnDate: true,
      returnTime: true,
      pickupLocation: true,
      returnLocation: true,
      priceQuote: true,
      total: true,
      cancelReasonCode: true,
      cancelNote: true,
      paymentMethod: true,
      paymentStatus: true,
      paymentExpiresAt: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, amountCents: true, refundedCents: true, retainedCents: true, checkoutUrl: true, expiresAt: true },
      },
      // ΜΟΝΟ μικρό όνομα και email (μασκάρεται) — ποτέ τηλέφωνο, ηλικία, σχόλια, πτήση.
      customer: { select: { firstName: true, email: true } },
      rentalGroup: { select: { name: true, similarModels: true, photos: true } },
      vehicle: { select: { brand: true, model: true, photos: true } },
    },
  });
  if (!b || !b.publicCode) return null;
  const g = b.rentalGroup;
  const similar = g ? similarModelName(textFor(readLocalized(g.similarModels), lang)) : "";
  return toConfirmationDTO({
    ...b,
    publicCode: b.publicCode,
    payment: b.payments[0] ?? null,
    groupName: g ? textFor(readLocalized(g.name), lang) : `${b.vehicle.brand} ${b.vehicle.model}`,
    groupSimilar: similar || null,
    photoUrl: (g && readVehiclePhotos(g.photos)[0]?.url) || readVehiclePhotos(b.vehicle.photos)[0]?.url || null,
  });
}
