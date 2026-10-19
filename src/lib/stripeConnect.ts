// src/lib/stripeConnect.ts
// Stripe Connect (Express) — ΜΟΝΟ server. Online πληρωμές κρατήσεων με
// direct charge στον λογαριασμό ΤΗΣ ΕΤΑΙΡΙΑΣ (header stripeAccount).
// ΧΩΡΙΣΤΟ από οποιαδήποτε μελλοντική χρέωση συνδρομών της πλατφόρμας.
//
// Env (Vercel, ποτέ στον κώδικα):
//   STRIPE_SECRET_KEY              — το secret key του λογαριασμού της πλατφόρμας
//   STRIPE_CONNECT_WEBHOOK_SECRET  — το signing secret του Connect webhook
// Αν λείπει κάποιο: οι online πληρωμές απλώς δεν εμφανίζονται (η κράτηση με
// πληρωμή στην παραλαβή δουλεύει κανονικά) και τα logs γράφουν ΠΟΙΟ όνομα
// λείπει — ποτέ τιμές.

import Stripe from "stripe";
import { missingStripeEnv } from "./stripeConnectEnv";

export { missingStripeEnv };

const value = (name: string) => (process.env[name] ?? "").trim();

let warned = false;
/** true = μπορούμε να δεχτούμε online πληρωμές. Μία φορά ανά instance γράφει στα logs τι λείπει. */
export function stripeReady(): boolean {
  const missing = missingStripeEnv();
  if (missing.length && !warned) {
    warned = true;
    console.warn(`[FleetPro] Stripe Connect: λείπει ${missing.join(", ")} — οι online πληρωμές είναι κρυφές.`);
  }
  return missing.length === 0;
}

/** Test ή live (από το πρόθεμα του κλειδιού) — για τα links προς τον πίνακα Stripe. */
export const stripeLiveMode = () => value("STRIPE_SECRET_KEY").startsWith("sk_live_");

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = value("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  if (!client) client = new Stripe(key, { apiVersion: "2023-10-16", maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

/** Ποτέ μήνυμα του Stripe (μπορεί να έχει στοιχεία) στα logs — μόνο τύπος/κωδικός. */
export function stripeErrorCode(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { type?: unknown; code?: unknown };
    return [o.type, o.code].filter((x) => typeof x === "string").join(":") || "error";
  }
  return "error";
}

export const accountFlags = (a: Pick<Stripe.Account, "charges_enabled" | "payouts_enabled" | "details_submitted">) => ({
  stripeChargesEnabled: a.charges_enabled === true,
  stripePayoutsEnabled: a.payouts_enabled === true,
  stripeDetailsSubmitted: a.details_submitted === true,
});
