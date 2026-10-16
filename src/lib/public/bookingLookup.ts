// src/lib/public/bookingLookup.ts
// Η σελίδα επιβεβαίωσης — ΜΟΝΟ server. Η κράτηση βρίσκεται ΜΟΝΟ με τον κωδικό
// ΚΑΙ μέσα στην εταιρία του slug: κωδικός άλλης εταιρίας = null (404).
// Η τιμή από το ΑΠΟΘΗΚΕΥΜΕΝΟ priceQuote — κανένας νέος υπολογισμός.

import { db } from "../db";
import { readVehiclePhotos } from "../vehiclePhotos";
import { normalizeBookingCode, toConfirmationDTO, type ConfirmationDTO } from "./bookingRequest";
import { similarModelName } from "./catalog";
import { readLocalized, textFor } from "./text";

export async function loadConfirmation(companyId: string, rawCode: string, lang: string): Promise<ConfirmationDTO | null> {
  const code = normalizeBookingCode(rawCode);
  if (!code) return null;
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
    groupName: g ? textFor(readLocalized(g.name), lang) : `${b.vehicle.brand} ${b.vehicle.model}`,
    groupSimilar: similar || null,
    photoUrl: (g && readVehiclePhotos(g.photos)[0]?.url) || readVehiclePhotos(b.vehicle.photos)[0]?.url || null,
  });
}
