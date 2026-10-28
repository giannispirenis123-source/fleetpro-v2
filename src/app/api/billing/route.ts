export const dynamic = "force-dynamic";
// src/app/api/billing/route.ts
// GET /api/billing — η συνδρομή της ΙΔΙΑΣ εταιρίας (μόνο Διαχειριστής).
// Η εταιρία ΠΑΝΤΑ από το session· κανένα id από τον client.

import { withAuth, ok, notFound, serverError, logError } from "@/lib/api";
import { billingOverview } from "@/lib/billing/billingServer";

export const GET = withAuth(async (_req, session) => {
  try {
    const o = await billingOverview(session.tenantId!);
    return o ? ok(o) : notFound();
  } catch (error) {
    logError("billing", error);
    return serverError();
  }
}, ["COMPANY_ADMIN"]);
