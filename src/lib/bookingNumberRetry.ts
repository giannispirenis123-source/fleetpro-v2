// src/lib/bookingNumberRetry.ts
// Σύγκρουση στο UNIQUE (tenantId, bookingNumber) (SQL 30) → η transaction
// της κράτησης ξανατρέχει ολόκληρη (ο επόμενος αριθμός βλέπει πια τον
// αριθμό που πρόλαβε άλλος) — ποτέ 500 στον χρήστη. ΚΑΘΑΡΗ λογική (tests).
//
// Κανονικά δεν συμβαίνει: site, dashboard και walk-in παίρνουν αριθμό μέσα
// στο ίδιο κλείδωμα εταιρίας. Μένει για ό,τι γράφει εκτός κλειδώματος (π.χ.
// παλιά έκδοση κατά το deploy, χειροκίνητο SQL).

export const BOOKING_NUMBER_ATTEMPTS = 3;

/** P2002 του Prisma πάνω στον αριθμό κράτησης (πεδία ή όνομα index). */
export function isBookingNumberConflict(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const o = e as { code?: unknown; meta?: { target?: unknown } };
  if (o.code !== "P2002") return false;
  const t = o.meta?.target;
  const text = Array.isArray(t) ? t.join(",") : typeof t === "string" ? t : "";
  return /bookingNumber/.test(text);
}

export async function withBookingNumberRetry<T>(fn: () => Promise<T>, attempts = BOOKING_NUMBER_ATTEMPTS): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || !isBookingNumberConflict(e)) throw e;
    }
  }
}
