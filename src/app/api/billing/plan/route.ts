export const dynamic = "force-dynamic";
// src/app/api/billing/plan/route.ts
// POST /api/billing/plan { plan, interval } — αλλαγή πλάνου ΠΡΙΝ από το Stripe
// (δοκιμή ιδρυτή / αναμονή Checkout). Με ζωντανή συνδρομή: 409 → Πύλη πελάτη.

import { ok, withAuth } from "@/lib/api";
import { changePlanBeforeCheckout } from "@/lib/billing/billingServer";
import { billingFailure } from "@/lib/billing/routeHelpers";

export const POST = withAuth(async (req, session) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { plan?: unknown; interval?: unknown };
    await changePlanBeforeCheckout(session.tenantId!, body.plan, body.interval);
    return ok({ saved: true });
  } catch (e) {
    return billingFailure("billing/plan", e);
  }
}, ["COMPANY_ADMIN"]);
