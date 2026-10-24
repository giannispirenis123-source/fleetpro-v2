export const dynamic = "force-dynamic";
// src/app/api/billing/portal/route.ts
// POST /api/billing/portal — Πύλη πελάτη του Stripe (αλλαγή πλάνου, κάρτας,
// ακύρωση) για τον πελάτη Stripe της ΙΔΙΑΣ εταιρίας (μόνο Διαχειριστής).

import { ok, withAuth } from "@/lib/api";
import { openPortal } from "@/lib/billing/billingServer";
import { billingFailure, billingOrigin, tooMany } from "@/lib/billing/routeHelpers";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";

export const POST = withAuth(async (req, session) => {
  try {
    if (!(await hitLimit(dbCounterStore, LIMITS.billingCheckoutPerTenant, session.tenantId!))) return tooMany();
    return ok({ url: await openPortal(session.tenantId!, billingOrigin(req)) });
  } catch (e) {
    return billingFailure("billing/portal", e);
  }
}, ["COMPANY_ADMIN"]);
