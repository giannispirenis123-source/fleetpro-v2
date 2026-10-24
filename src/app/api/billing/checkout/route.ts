export const dynamic = "force-dynamic";
// src/app/api/billing/checkout/route.ts
// POST /api/billing/checkout { plan, interval } — Stripe Checkout για τη
// συνδρομή της ΙΔΙΑΣ εταιρίας (μόνο Διαχειριστής). Τιμή ΜΟΝΟ από τα price
// ids του server (env)· δοκιμή/έκπτωση τις αποφασίζει ο server (core.ts).

import { ok } from "@/lib/api";
import { withAuth } from "@/lib/api";
import { startCheckout } from "@/lib/billing/billingServer";
import { billingFailure, billingOrigin, tooMany } from "@/lib/billing/routeHelpers";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";

export const POST = withAuth(async (req, session) => {
  try {
    if (!(await hitLimit(dbCounterStore, LIMITS.billingCheckoutPerTenant, session.tenantId!))) return tooMany();
    const body = (await req.json().catch(() => ({}))) as { plan?: unknown; interval?: unknown };
    const url = await startCheckout(session.tenantId!, body.plan, body.interval, billingOrigin(req), session.locale === "en" ? "en" : "el");
    return ok({ url });
  } catch (e) {
    return billingFailure("billing/checkout", e);
  }
}, ["COMPANY_ADMIN"]);
