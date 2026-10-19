export const dynamic = "force-dynamic";
// src/app/api/public-site/payments/login-link/route.ts
// «Πίνακας Stripe»: μιας χρήσης σύνδεσμος στον πίνακα Express της εταιρίας.
// ΜΟΝΟ Διαχειριστής με publicSite.

import { db } from "@/lib/db";
import { badRequest, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { stripe, stripeErrorCode, stripeReady } from "@/lib/stripeConnect";

// POST /api/public-site/payments/login-link → { url }
export const POST = withPublicSite(async (_req, companyId) => {
  if (!stripeReady()) return badRequest("Οι online πληρωμές δεν είναι ρυθμισμένες στον server.");
  try {
    const t = await db.tenant.findUnique({ where: { id: companyId }, select: { stripeAccountId: true, stripeDetailsSubmitted: true } });
    if (!t?.stripeAccountId) return badRequest("Δεν υπάρχει συνδεδεμένος λογαριασμός Stripe.");
    if (!t.stripeDetailsSubmitted) return badRequest("Ολοκληρώστε πρώτα τη ρύθμιση στο Stripe.");
    const link = await stripe().accounts.createLoginLink(t.stripeAccountId);
    return ok({ url: link.url });
  } catch (error) {
    console.error(`[FleetPro] Stripe login link: ${stripeErrorCode(error)}`);
    return serverError("Το Stripe δεν απάντησε. Δοκιμάστε ξανά σε λίγο.");
  }
});
