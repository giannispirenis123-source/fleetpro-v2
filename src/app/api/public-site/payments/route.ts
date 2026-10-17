export const dynamic = "force-dynamic";
// src/app/api/public-site/payments/route.ts
// «Η σελίδα μου» → «Πληρωμές»: κατάσταση λογαριασμού Stripe και ρυθμίσεις.
// ΜΟΝΟ Διαχειριστής με publicSite (withPublicSite)· η εταιρία από τη συνεδρία.
// Η προμήθεια της πλατφόρμας ΔΕΝ εμφανίζεται εδώ (μόνο ο Super Admin).

import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { accountStatus, effectivePaymentOptions, paymentSettingsSchema } from "@/lib/public/payments";
import { PAYMENT_SETTINGS_SELECT, refreshAccount } from "@/lib/public/paymentServer";
import { missingStripeEnv, stripeLiveMode, stripeReady } from "@/lib/stripeConnect";

async function dto(companyId: string, refresh: boolean) {
  let t = await db.tenant.findUnique({ where: { id: companyId }, select: PAYMENT_SETTINGS_SELECT });
  if (!t) return null;
  const ready = stripeReady();
  // Επανέλεγχος από το Stripe όταν ανοίγει η καρτέλα (το webhook μπορεί να άργησε).
  if (refresh && ready && t.stripeAccountId) {
    const flags = await refreshAccount(companyId, t.stripeAccountId);
    if (flags) t = { ...t, ...flags };
  }
  return {
    account: {
      status: accountStatus(t),
      chargesEnabled: t.stripeChargesEnabled,
      payoutsEnabled: t.stripePayoutsEnabled,
      detailsSubmitted: t.stripeDetailsSubmitted,
    },
    settings: { paymentOptions: t.paymentOptions, onlineAmountType: t.onlineAmountType, depositPercent: t.depositPercent },
    effective: effectivePaymentOptions(t, ready),
    server: { ready, missing: missingStripeEnv(), live: ready && stripeLiveMode() },
  };
}

// GET /api/public-site/payments
export const GET = withPublicSite(async (_req, companyId) => {
  try {
    const d = await dto(companyId, true);
    return d ? ok(d) : notFound();
  } catch (error) {
    console.error("[FleetPro] payments GET:", error instanceof Error ? error.name : "");
    return serverError();
  }
});

// PATCH /api/public-site/payments — { paymentOptions, onlineAmountType, depositPercent }
export const PATCH = withPublicSite(async (req, companyId) => {
  try {
    const parsed = paymentSettingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα", parsed.error.errors);
    await db.tenant.update({ where: { id: companyId }, data: parsed.data });
    return ok(await dto(companyId, false));
  } catch (error) {
    console.error("[FleetPro] payments PATCH:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
