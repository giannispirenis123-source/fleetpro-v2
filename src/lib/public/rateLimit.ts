// src/lib/public/rateLimit.ts
// Όρια κατάχρησης για τα δημόσια endpoints — δουλεύουν σε serverless γιατί ο
// μετρητής ζει στη ΒΑΣΗ (πίνακας rate_limits, SQL 23), όχι στη μνήμη.
//
// · Σταθερά παράθυρα χρόνου (π.χ. 60΄): ένας μετρητής ανά (κλειδί, αρχή παραθύρου).
// · Το κλειδί είναι HASH (sha256 με μυστικό του server): ποτέ IP ή email σε
//   καθαρή μορφή στη βάση.
// · Η λογική είναι καθαρή (store ως παράμετρος) → tests χωρίς βάση.

import { createHash } from "node:crypto";

export interface CounterStore {
  /** +1 στον μετρητή (κλειδί, παράθυρο) και επιστρέφει τη νέα τιμή. */
  increment(key: string, windowStart: Date): Promise<number>;
}

export interface Limit {
  /** π.χ. "book-email" */
  scope: string;
  max: number;
  windowMinutes: number;
}

/** Τα όρια της δημόσιας κράτησης. */
export const LIMITS = {
  bookingPerEmail: { scope: "book-email", max: 5, windowMinutes: 60 },
  bookingPerTenant: { scope: "book-tenant", max: 30, windowMinutes: 60 },
  confirmationPerClient: { scope: "booking-view", max: 60, windowMinutes: 10 },
  /** Δημιουργία Stripe Checkout Session ανά εταιρία. */
  checkoutPerTenant: { scope: "checkout-tenant", max: 30, windowMinutes: 60 },
  /** Εφεδρικός έλεγχος πληρωμής στο Stripe (retrieve): 1 ανά 10΄΄ ανά κράτηση. */
  paymentCheckPerBooking: { scope: "pay-check", max: 1, windowMinutes: 1 / 6 },
} as const satisfies Record<string, Limit>;

/** Κλειδί χωρίς προσωπικά δεδομένα: scope + hash(μυστικό + τιμή). */
export function limitKey(scope: string, value: string, secret = process.env.JWT_SECRET ?? "fleetpro"): string {
  const h = createHash("sha256").update(`${secret}|${scope}|${value.trim().toLowerCase()}`).digest("hex").slice(0, 40);
  return `${scope}:${h}`;
}

export function windowStartOf(now: Date, windowMinutes: number): Date {
  const ms = windowMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/** true = επιτρέπεται (και μετρήθηκε). */
export async function hitLimit(store: CounterStore, limit: Limit, value: string, now = new Date()): Promise<boolean> {
  const count = await store.increment(limitKey(limit.scope, value), windowStartOf(now, limit.windowMinutes));
  return count <= limit.max;
}
