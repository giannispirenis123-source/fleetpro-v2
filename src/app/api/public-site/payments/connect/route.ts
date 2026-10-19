export const dynamic = "force-dynamic";
// src/app/api/public-site/payments/connect/route.ts
// «Σύνδεση με Stripe» / «Συνέχεια ρύθμισης»: λογαριασμός Connect τύπου Express
// (μία φορά ανά εταιρία) + Account Link προς το onboarding του Stripe, με
// επιστροφή στην καρτέλα «Πληρωμές». ΜΟΝΟ Διαχειριστής με publicSite.

import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { publicOrigin } from "@/lib/bookingDecisionServer";
import { stripe, stripeErrorCode, stripeReady } from "@/lib/stripeConnect";

const BACK = "/dashboard/storefront?tab=payments";

// POST /api/public-site/payments/connect → { url }
export const POST = withPublicSite(async (req, companyId) => {
  if (!stripeReady()) return badRequest("Οι online πληρωμές δεν είναι ρυθμισμένες στον server.");
  try {
    const t = await db.tenant.findUnique({
      where: { id: companyId },
      select: { name: true, email: true, stripeAccountId: true, storefrontSlug: true },
    });
    if (!t) return notFound();
    const origin = publicOrigin(req);

    let accountId = t.stripeAccountId;
    if (!accountId) {
      const account = await stripe().accounts.create(
        {
          type: "express",
          country: "GR",
          ...(t.email ? { email: t.email } : {}),
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          business_profile: {
            name: t.name.slice(0, 100),
            ...(t.storefrontSlug ? { url: `${origin}/s/${t.storefrontSlug}` } : {}),
          },
          metadata: { tenantId: companyId },
        },
        // Κλειδί ανά 10΄: προστατεύει από διπλό πάτημα, αλλά δεν «κολλάει» για 24 ώρες
        // σε μια παλιά αποτυχημένη απάντηση του Stripe (replay ίδιου κλειδιού).
        { idempotencyKey: `fleetpro-account-${companyId}-${Math.floor(Date.now() / 600_000)}` }
      );
      accountId = account.id;
      // Μόνο αν δεν γράφτηκε στο μεταξύ άλλος (διπλό πάτημα).
      const r = await db.tenant.updateMany({ where: { id: companyId, stripeAccountId: null }, data: { stripeAccountId: accountId } });
      if (r.count === 0) {
        accountId = (await db.tenant.findUnique({ where: { id: companyId }, select: { stripeAccountId: true } }))?.stripeAccountId ?? accountId;
      }
    }

    const link = await stripe().accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${origin}${BACK}&stripe=refresh`,
      return_url: `${origin}${BACK}&stripe=return`,
    });
    return ok({ url: link.url });
  } catch (error) {
    console.error(`[FleetPro] Stripe connect: ${stripeErrorCode(error)}`);
    return serverError("Το Stripe δεν απάντησε. Δοκιμάστε ξανά σε λίγο.");
  }
});
