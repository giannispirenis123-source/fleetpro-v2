// src/lib/public/availability.ts
// Διαθεσιμότητα του δημόσιου site: ΠΟΣΑ οχήματα κάθε ομάδας είναι ελεύθερα
// σε ένα διάστημα. Στο site φεύγει ΜΟΝΟ ο αριθμός — ποτέ ποια οχήματα.
//
// Πηγή αλήθειας = ο πίνακας bookings, όπως και στον έλεγχο σύγκρουσης του
// dashboard (src/lib/bookings.ts → findConflicts, CONFLICT_STATUSES):
//   · Κάθε συμβόλαιο ανήκει σε ΜΙΑ κράτηση (contracts.bookingId UNIQUE) και η
//     κράτηση ακολουθεί το συμβόλαιο (ACTIVE / COMPLETED), άρα οι κρατήσεις
//     καλύπτουν και τα συμβόλαια. Από το συμβόλαιο διαβάζεται μόνο το
//     vehicleChanges: σε αλλαγή οχήματος δεσμεύονται ΚΑΙ τα δύο οχήματα.
//   · «Κλείνουν» όχημα: PENDING, CONFIRMED, ACTIVE. Όχι CANCELLED, όχι
//     COMPLETED (έχει επιστραφεί). Μια ACTIVE που έπρεπε να έχει επιστραφεί
//     (καθυστέρηση) κρατά το όχημα μέχρι «τώρα».
//   · Χρόνος προετοιμασίας (tenants.prepTimeMinutes) και από τις δύο πλευρές.
//   · Όχημα σε service (status MAINTENANCE) ή «Ανενεργό» δεν μετρά ποτέ.
//
// Ώρες: όπως στο dashboard, ημερομηνία + "HH:mm" ως «ώρα τοίχου» της
// εταιρίας· κράτηση χωρίς ώρα = όλη η ημέρα (00:00 → 23:59).
//
// Καθαρή λογική + ΕΝΑ ερώτημα (loadBlockingBookings) με τον Prisma client ως
// παράμετρο — έτσι τα tests τρέχουν χωρίς βάση.

import type { PrismaClient } from "@prisma/client";

/** Ίδιες με το CONFLICT_STATUSES του src/lib/bookings.ts. */
export const BLOCKING_STATUSES = ["PENDING", "CONFIRMED", "ACTIVE"] as const;

/** Καταστάσεις οχήματος που το βγάζουν εκτός (service / ανενεργό). */
export const OUT_OF_SERVICE = ["MAINTENANCE", "INACTIVE"] as const;

export interface FleetVehicle {
  id: string;
  tenantId: string;
  /** Σε ποια κάρτα μετρά ("g.<code>" ή "v.<id>")· null = σε καμία. */
  groupKey: string | null;
  status: string;
  isActive: boolean;
}

export interface BlockingBooking {
  tenantId: string;
  vehicleId: string;
  status: string;
  /** "YYYY-MM-DD" */
  pickupDate: string;
  pickupTime: string | null;
  returnDate: string;
  returnTime: string | null;
  /** Οχήματα από αλλαγές οχήματος στο συμβόλαιο. */
  extraVehicleIds?: string[];
}

export interface Interval {
  start: number;
  end: number;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Ημερομηνία + ώρα → ms «ώρας τοίχου» (σύγκριση μόνο μεταξύ τους, όχι
 * πραγματική στιγμή). Χωρίς ώρα: αρχή 00:00, τέλος 23:59 — συντηρητικά.
 */
export function wallClockMs(date: string, time: string | null | undefined, fallback: "start" | "end"): number {
  const t = time && TIME_RE.test(time) ? time : fallback === "start" ? "00:00" : "23:59";
  return Date.parse(`${date}T${t}:00.000Z`);
}

/** "YYYY-MM-DDTHH:mm" → ms ώρας τοίχου. NaN αν είναι άκυρο. */
export const localMs = (v: string): number => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? Date.parse(`${v}:00.000Z`) : NaN);

/**
 * Συγκρούονται δύο διαστήματα, με κενό προετοιμασίας `prepMs` ανάμεσα;
 * Επιστροφή 10:00 και νέα παραλαβή 10:00 = ΟΧΙ σύγκρουση όταν prep = 0
 * (ίδιος κανόνας με το findConflicts του dashboard).
 */
export function intervalsConflict(a: Interval, b: Interval, prepMs = 0): boolean {
  const prep = Math.max(0, prepMs);
  return a.start < b.end + prep && b.start < a.end + prep;
}

export function bookingInterval(b: BlockingBooking, nowMs?: number): Interval {
  const start = wallClockMs(b.pickupDate, b.pickupTime, "start");
  let end = wallClockMs(b.returnDate, b.returnTime, "end");
  // Καθυστέρηση: το όχημα δεν έχει γυρίσει, άρα δεν είναι ελεύθερο πριν από «τώρα».
  if (b.status === "ACTIVE" && nowMs !== undefined && nowMs > end) end = nowMs;
  return { start, end };
}

export interface AvailabilityInput {
  companyId: string;
  vehicles: FleetVehicle[];
  bookings: BlockingBooking[];
  /** "YYYY-MM-DDTHH:mm" */
  from: string;
  to: string;
  prepMinutes: number;
  /** "YYYY-MM-DDTHH:mm" — τώρα, στη ζώνη της εταιρίας (για τις καθυστερήσεις). */
  now?: string;
}

/** Τα οχήματα που ΚΛΕΙΝΟΥΝ στο διάστημα (κρατήσεις της ίδιας εταιρίας). */
function blockedIds(input: AvailabilityInput, window: Interval): Set<string> {
  const nowMs = input.now ? localMs(input.now) : undefined;
  const prep = Math.max(0, input.prepMinutes) * 60_000;
  const blocked = new Set<string>();
  for (const b of input.bookings) {
    if (b.tenantId !== input.companyId) continue;
    if (!(BLOCKING_STATUSES as readonly string[]).includes(b.status)) continue;
    if (!intervalsConflict(window, bookingInterval(b, Number.isFinite(nowMs) ? nowMs : undefined), prep)) continue;
    blocked.add(b.vehicleId);
    for (const id of b.extraVehicleIds ?? []) blocked.add(id);
  }
  return blocked;
}

const windowOf = (input: AvailabilityInput): Interval | null => {
  const w = { start: localMs(input.from), end: localMs(input.to) };
  return Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start ? w : null;
};

const usable = (input: AvailabilityInput, v: FleetVehicle) =>
  v.tenantId === input.companyId && v.isActive && !(OUT_OF_SERVICE as readonly string[]).includes(v.status);

/**
 * Τα ΕΛΕΥΘΕΡΑ οχήματα μιας κάρτας στο [from, to] — για την αυτόματη ανάθεση
 * οχήματος σε κράτηση του site. Ίδιοι κανόνες με το countAvailableByGroup.
 */
export function freeVehicleIds(input: AvailabilityInput, groupKey: string): string[] {
  const window = windowOf(input);
  if (!window) return [];
  const blocked = blockedIds(input, window);
  return input.vehicles.filter((v) => v.groupKey === groupKey && usable(input, v) && !blocked.has(v.id)).map((v) => v.id);
}

/**
 * Πόσα οχήματα κάθε κάρτας είναι ελεύθερα στο [from, to].
 * Οχήματα/κρατήσεις ΑΛΛΗΣ εταιρίας αγνοούνται (δεύτερη δικλείδα πέρα από το
 * WHERE του ερωτήματος). Κάθε κράτηση του site έχει όχημα (ανατίθεται αυτόματα
 * τη στιγμή της υποβολής), άρα μετρά κανονικά στην ομάδα της.
 */
export function countAvailableByGroup(input: AvailabilityInput): Map<string, number> {
  const counts = new Map<string, number>();
  const window = windowOf(input);
  if (!window) return counts;
  const blocked = blockedIds(input, window);
  for (const v of input.vehicles) {
    if (v.tenantId !== input.companyId || !v.groupKey) continue;
    if (!counts.has(v.groupKey)) counts.set(v.groupKey, 0);
    if (!usable(input, v) || blocked.has(v.id)) continue;
    counts.set(v.groupKey, counts.get(v.groupKey)! + 1);
  }
  return counts;
}

/* ─────────────────────────────────────────────
   Το ΕΝΑ ερώτημα ανά αναζήτηση
   ───────────────────────────────────────────── */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function changedVehicleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => (isObject(c) && typeof c.vehicleId === "string" && c.vehicleId ? [c.vehicleId] : []));
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Οι κρατήσεις της εταιρίας που ΜΠΟΡΕΙ να πέφτουν στο διάστημα — ΕΝΑ query
 * για όλο τον στόλο. Περιθώριο 3 ημερών πριν (χρόνος προετοιμασίας έως 24ω)
 * και όλες οι ACTIVE που ξεκίνησαν πριν το τέλος (καθυστερήσεις).
 * Μόνο ό,τι χρειάζεται: όχημα, κατάσταση, ημερομηνίες/ώρες, αλλαγές οχήματος.
 */
export async function loadBlockingBookings(
  client: Pick<PrismaClient, "booking">,
  companyId: string,
  window: { from: string; to: string }
): Promise<BlockingBooking[]> {
  const from = new Date(`${window.from.slice(0, 10)}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 3);
  const until = new Date(`${window.to.slice(0, 10)}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 2);

  const rows = await client.booking.findMany({
    where: {
      tenantId: companyId,
      status: { in: [...BLOCKING_STATUSES] },
      pickupDate: { lte: until },
      OR: [{ returnDate: { gte: from } }, { status: "ACTIVE" }],
    },
    select: {
      tenantId: true,
      vehicleId: true,
      status: true,
      pickupDate: true,
      pickupTime: true,
      returnDate: true,
      returnTime: true,
      contract: { select: { vehicleChanges: true } },
    },
  });

  return rows.map((r) => ({
    tenantId: r.tenantId,
    vehicleId: r.vehicleId,
    status: r.status,
    pickupDate: isoDate(r.pickupDate),
    pickupTime: r.pickupTime,
    returnDate: isoDate(r.returnDate),
    returnTime: r.returnTime,
    extraVehicleIds: changedVehicleIds(r.contract?.vehicleChanges),
  }));
}
