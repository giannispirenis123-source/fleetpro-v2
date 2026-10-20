export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/payment/route.ts
// Πληρωμή ενοικίου του συμβολαίου με κάρτα μέσω Stripe (link + QR).
// GET  → κατάσταση (σε αναμονή / πληρώθηκε / απέτυχε…), link και QR όσο ισχύει.
// POST → βγάζει (ή ξαναδίνει) το link. Ποσό ΜΟΝΟ από τον server· ο browser
//        δεν στέλνει τίποτα. Συμβόλαιο ΜΟΝΟ της εταιρίας του χρήστη.

import { NextResponse } from "next/server";
import { notFound, ok, serverError, logError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { publicOrigin } from "@/lib/bookingDecisionServer";
import { loadContractPaymentContext, openContractCheckout, toContractPaymentDTO } from "@/lib/contractPayment";

const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const ctx = await loadContractPaymentContext(viewer!, params!.id);
      if (!ctx) return notFound("Το συμβόλαιο δεν βρέθηκε");
      return NextResponse.json({ success: true, data: await toContractPaymentDTO(ctx) }, { headers: NO_STORE });
    } catch (error) {
      logError("contracts/[id]/payment GET", error);
      return serverError();
    }
  },
  "contracts.view"
);

export const POST = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const ctx = await loadContractPaymentContext(viewer!, params!.id);
      if (!ctx) return notFound("Το συμβόλαιο δεν βρέθηκε");
      const r = await openContractCheckout(ctx, publicOrigin(req));
      if (!r.ok) return NextResponse.json({ success: false, message: r.message }, { status: r.status, headers: NO_STORE });
      const fresh = await loadContractPaymentContext(viewer!, params!.id);
      return ok(fresh ? await toContractPaymentDTO(fresh) : null);
    } catch (error) {
      logError("contracts/[id]/payment POST", error);
      return serverError();
    }
  },
  "contracts.edit"
);
