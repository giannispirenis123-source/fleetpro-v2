export const dynamic = "force-dynamic";
// src/app/api/billing/sync/route.ts
// POST /api/billing/sync — εφεδρικός συγχρονισμός από το Stripe (μετά την
// επιστροφή από το Checkout, αν το webhook αργεί). Ίδια λογική με το webhook,
// μόνο για τον πελάτη Stripe της ΙΔΙΑΣ εταιρίας.

import { ok, withAuth } from "@/lib/api";
import { syncTenantFromStripe } from "@/lib/billing/billingServer";
import { billingFailure, tooMany } from "@/lib/billing/routeHelpers";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";

export const POST = withAuth(async (_req, session) => {
  try {
    if (!(await hitLimit(dbCounterStore, LIMITS.billingSyncPerTenant, session.tenantId!))) return tooMany();
    return ok({ synced: await syncTenantFromStripe(session.tenantId!) });
  } catch (e) {
    return billingFailure("billing/sync", e);
  }
}, ["COMPANY_ADMIN"]);
