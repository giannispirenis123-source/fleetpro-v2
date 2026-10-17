// src/lib/stripeConnectEnv.ts
// Ποια env χρειάζονται οι online πληρωμές (Stripe Connect) — καθαρό, χωρίς
// τη βιβλιοθήκη stripe, ώστε να ελέγχεται στα tests. Ποτέ τιμές, μόνο ονόματα.

export const STRIPE_ENV = ["STRIPE_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET"] as const;

/** Τα ονόματα που λείπουν (κενό = λείπει). */
export function missingStripeEnv(env: Record<string, string | undefined> = process.env): string[] {
  return STRIPE_ENV.filter((n) => !(env[n] ?? "").trim());
}
