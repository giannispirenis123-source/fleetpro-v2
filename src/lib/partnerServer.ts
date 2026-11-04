// src/lib/partnerServer.ts
// Συνεργάτης — ΜΟΝΟ server: οικονομικά, διαθεσιμότητα, κράτηση από το dashboard.
//
// Στεγανότητα: εταιρία ΜΟΝΟ από το session (viewer.tenantId), κρατήσεις ΜΟΝΟ
// με partnerId = ο ίδιος (bookingScope). Τα φίλτρα μπαίνουν στο ερώτημα της
// βάσης· τίποτα άλλου συνεργάτη ή άλλης εταιρίας δεν φορτώνεται καν.

import type { Viewer } from "./authz";
import { bookingScope } from "./authz";
import { db } from "./db";
import { NO_COMMISSION } from "./commission";
import { myCommissionSettings } from "./listServer";
import { storedTotalCents } from "./public/money";
import { loadBlockingBookings } from "./public/availability";
import { tenantNowLocal } from "./bookingConflicts";
import { monthRange, partnerFinance } from "./partnerFinance";
import { availabilityGrid, dayList } from "./partnerAvailability";
import { findDuplicateCustomers, loadWalkInVehicles } from "./walkIn";
import { foldText } from "./customerMatch";

/** Μόνο ενεργός συνεργάτης εταιρίας — κανένας άλλος ρόλος (ούτε ο Διαχειριστής). */
export const isPartnerViewer = (viewer: Viewer | undefined | null): viewer is Viewer & { tenantId: string } =>
  !!viewer && viewer.role === "PARTNER" && !!viewer.tenantId;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/* ── Οικονομικά ── */

export async function loadPartnerFinance(viewer: Viewer & { tenantId: string }, month: string | null) {
  const range = month ? monthRange(month) : null;
  const scope = bookingScope(viewer); // { tenantId, partnerId: ο ίδιος }
  const [rows, settings] = await Promise.all([
    db.booking.findMany({
      where: { ...scope, ...(range && { pickupDate: { gte: range.from, lt: range.to } }) },
      orderBy: [{ pickupDate: "desc" }, { bookingNumber: "desc" }],
      take: 1000,
      select: {
        id: true,
        bookingNumber: true,
        pickupDate: true,
        returnDate: true,
        status: true,
        paymentStatus: true,
        total: true,
        priceQuote: true,
        subtotal: true,
        extrasTotal: true,
        insuranceCost: true,
        vehicle: { select: { brand: true, model: true, plate: true } },
      },
    }),
    // ΙΔΙΕΣ ρυθμίσεις με τη σύνοψη προμήθειας των κρατήσεων (τρέχον ποσοστό).
    myCommissionSettings(viewer, true),
  ]);
  return partnerFinance(
    rows.map((r) => ({
      id: r.id,
      bookingNumber: r.bookingNumber,
      pickupDate: iso(r.pickupDate),
      returnDate: iso(r.returnDate),
      vehicle: `${r.vehicle.brand} ${r.vehicle.model} · ${r.vehicle.plate}`,
      status: r.status,
      paymentStatus: r.paymentStatus,
      totalCents: storedTotalCents(r.priceQuote, r.total),
      subtotal: Number(r.subtotal),
      extrasTotal: Number(r.extrasTotal),
      insuranceCost: Number(r.insuranceCost),
    })),
    settings ?? NO_COMMISSION
  );
}

/* ── Διαθεσιμότητα ── */

export async function loadPartnerAvailability(viewer: Viewer & { tenantId: string }, from: string, days: number, now = new Date()) {
  const list = dayList(from, days);
  if (list.length === 0) return null;
  const tenantId = viewer.tenantId;
  const [vehicles, bookings, nowLocal] = await Promise.all([
    db.vehicle.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }, { plate: "asc" }],
      select: { id: true, tenantId: true, brand: true, model: true, plate: true, status: true, isActive: true },
    }),
    // ΤΟ ΙΔΙΟ ερώτημα δεσμεύσεων με site/dashboard (μόνο όχημα/κατάσταση/ημερομηνίες).
    loadBlockingBookings(db, tenantId, { from: `${list[0]}T00:00`, to: `${list[list.length - 1]}T23:59` }, now),
    tenantNowLocal(db, tenantId, now),
  ]);
  const rows = availabilityGrid({
    companyId: tenantId,
    vehicles: vehicles.map((v) => ({ id: v.id, tenantId: v.tenantId, label: `${v.brand} ${v.model} · ${v.plate}`, status: v.status, isActive: v.isActive })),
    bookings,
    days: list,
    now: nowLocal,
    instantMs: now.getTime(),
  });
  return { days: list, vehicles: rows };
}

/* ── Διαθέσιμα οχήματα για ΣΥΓΚΕΚΡΙΜΕΝΟ διάστημα (φόρμα κράτησης) ── */

export interface PartnerWindow {
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
}

/**
 * Τα ελεύθερα οχήματα για το [παραλαβή, επιστροφή] — η ΙΔΙΑ συνάρτηση με τη
 * φόρμα του προσωπικού (loadWalkInVehicles: ίδιο ερώτημα, καταστάσεις, χρόνος
 * προετοιμασίας, καθυστερήσεις). Τα μη διαθέσιμα ΔΕΝ επιστρέφονται· από κάθε
 * όχημα μόνο id + ετικέτα (καμία κράτηση, κανένας πελάτης, καμία τιμή).
 */
export async function loadPartnerVehicles(viewer: Viewer & { tenantId: string }, window: PartnerWindow) {
  const list = await loadWalkInVehicles(viewer.tenantId, window, false);
  return list.filter((v) => v.available).map((v) => ({ id: v.id, label: `${v.brand} ${v.model} · ${v.plate}` }));
}

/* ── Πελάτης κράτησης συνεργάτη ── */

const nameKey = (first: string, last: string) => foldText(`${first} ${last}`).replace(/\s+/g, " ").trim();

/**
 * Υπάρχων πελάτης με το ΙΔΙΟ email ή τηλέφωνο (ίδιος έλεγχος διπλότυπου με το
 * προσωπικό — findDuplicateCustomers) ΚΑΙ το ίδιο ονοματεπώνυμο (χωρίς τόνους/
 * κεφαλαία). Μόνο αν βρεθεί ΑΚΡΙΒΩΣ ένας· αλλιώς null → νέος πελάτης όπως πριν.
 * Το αποτέλεσμα ΔΕΝ επιστρέφεται ποτέ στον συνεργάτη (ούτε ότι υπήρχε), και ο
 * υπάρχων πελάτης δεν αλλάζει.
 */
export async function matchPartnerCustomer(
  tenantId: string,
  c: { firstName: string; lastName: string; phone?: string | null; email?: string | null }
): Promise<string | null> {
  if (!c.phone && !c.email) return null;
  const candidates = await findDuplicateCustomers(tenantId, c.phone ?? "", c.email ?? "");
  const want = nameKey(c.firstName, c.lastName);
  const same = candidates.filter((x) => foldText(x.name).replace(/\s+/g, " ").trim() === want);
  return same.length === 1 ? same[0].id : null;
}
