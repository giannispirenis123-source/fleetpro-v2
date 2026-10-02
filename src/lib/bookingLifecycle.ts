// src/lib/bookingLifecycle.ts
// Ό,τι συμβαίνει ΓΥΡΩ από μια αλλαγή κατάστασης κράτησης: δέσμευση
// οχήματος, αυτόματο τιμολόγιο στην ολοκλήρωση, και οι μεταβάσεις που
// ακολουθούν το συμβόλαιο. Κοινό για το PATCH κράτησης και τα Συμβόλαια.
//
// Server-only: εισάγει db.

import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { STATUS_TRANSITIONS, type BookingStatusValue } from "./bookings";
import { issueInvoiceForBooking } from "./invoiceIssue";

/** Το κοινό `db` ή μια transaction. */
type Client = Prisma.TransactionClient | typeof db;

/**
 * Ευθυγραμμίζει την κατάσταση του οχήματος με τις κρατήσεις του.
 * Δεσμευμένο αν υπάρχει έστω μία κράτηση σε CONFIRMED ή ACTIVE· αλλιώς
 * ελεύθερο — αλλά ποτέ δεν πειράζουμε όχημα σε συντήρηση ή ανενεργό.
 */
export async function syncVehicleStatus(
  vehicleId: string,
  tenantId: string,
  client: Client = db
) {
  const vehicle = await client.vehicle.findFirst({
    where: { id: vehicleId, tenantId },
    select: { id: true, status: true },
  });
  if (!vehicle) return;
  if (vehicle.status === "MAINTENANCE" || vehicle.status === "INACTIVE") return;

  const held = await client.booking.count({
    where: { tenantId, vehicleId, status: { in: ["CONFIRMED", "ACTIVE"] } },
  });

  const next = held > 0 ? "RENTED" : "AVAILABLE";
  if (next !== vehicle.status) {
    await client.vehicle.update({ where: { id: vehicle.id }, data: { status: next } });
  }
}

/**
 * Αυτόματη έκδοση τιμολογίου με το τέλος της ενοικίασης, αν η εταιρία
 * έχει `invoiceIssueTrigger = ON_COMPLETION`. Επιστρέφει τον αριθμό του
 * τιμολογίου (νέου ή ήδη υπάρχοντος), αλλιώς null.
 *
 * Η έκδοση είναι από μόνη της ιδεμποτική (μία κράτηση → ένα τιμολόγιο).
 * Αποτυχία δεν γυρίζει πίσω την ολοκλήρωση — καταγράφεται και το
 * τιμολόγιο βγαίνει χειροκίνητα.
 */
export async function issueInvoiceOnCompletion(
  tenantId: string,
  bookingId: string
): Promise<string | null> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { invoiceIssueTrigger: true },
  });
  if (tenant?.invoiceIssueTrigger !== "ON_COMPLETION") return null;

  const outcome = await issueInvoiceForBooking({ tenantId, bookingId });
  if (outcome.ok) return outcome.invoiceNumber;

  console.error("Αυτόματη έκδοση τιμολογίου:", outcome.message);
  return null;
}

/** Η «κανονική» πορεία μιας ενοικίασης που ακολουθεί το συμβόλαιο. */
const CONTRACT_PATH: readonly BookingStatusValue[] = ["CONFIRMED", "ACTIVE", "COMPLETED"];

/**
 * Η κράτηση ακολουθεί το συμβόλαιο: υπογραφή όλων → ACTIVE, ολοκλήρωση
 * → COMPLETED. ΜΟΝΟ προς τα εμπρός, βήμα-βήμα μέσα από τις επιτρεπτές
 * μεταβάσεις (STATUS_TRANSITIONS):
 *
 * - ήδη στον στόχο ή πιο πέρα → τίποτα (ποτέ προς τα πίσω)·
 * - CANCELLED → τίποτα·
 * - PENDING (αίτημα που δεν εγκρίθηκε) → τίποτα: η έγκριση μένει στον
 *   άνθρωπο, δεν την κάνει σιωπηρά το συμβόλαιο.
 *
 * Επιστρέφει την κατάσταση πριν και μετά, ή null αν δεν άλλαξε τίποτα.
 */
export async function advanceBookingWithContract(
  tx: Client,
  tenantId: string,
  bookingId: string,
  target: "ACTIVE" | "COMPLETED"
): Promise<{ from: string; to: string; vehicleId: string } | null> {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: { status: true, vehicleId: true },
  });
  if (!booking) return null;

  const from = booking.status as BookingStatusValue;
  const at = CONTRACT_PATH.indexOf(from);
  const goal = CONTRACT_PATH.indexOf(target);
  if (at < 0 || at >= goal) return null;

  let status = from;
  for (const step of CONTRACT_PATH.slice(at + 1, goal + 1)) {
    if (!(STATUS_TRANSITIONS[status] ?? []).includes(step)) break;
    status = step;
  }
  if (status === from) return null;

  // Φύλακας ταυτόχρονης αλλαγής: γράφουμε μόνο αν η κράτηση είναι ακόμα
  // εκεί που τη βρήκαμε (π.χ. όχι ακυρωμένη στο μεταξύ).
  const result = await tx.booking.updateMany({
    where: { id: bookingId, tenantId, status: from },
    data: { status },
  });
  if (result.count === 0) return null;

  return { from, to: status, vehicleId: booking.vehicleId };
}
