export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/payment/check/route.ts
// «Έλεγχος πληρωμής στο Stripe» για το συμβόλαιο — όταν το webhook αργεί ή
// δεν φτάνει (π.χ. preview με Vercel Authentication). Ίδια μετάβαση με το
// webhook (checkSessionNow): ποτέ «πληρώθηκε» από τον browser ή το redirect.

import { NextResponse } from "next/server";
import { notFound, serverError, logError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { checkContractPayment, loadContractPaymentContext, toContractPaymentDTO } from "@/lib/contractPayment";

export const POST = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const ctx = await loadContractPaymentContext(viewer!, params!.id);
      if (!ctx) return notFound("Το συμβόλαιο δεν βρέθηκε");
      const outcome = await checkContractPayment(ctx);
      if (outcome === "rate_limited") {
        return NextResponse.json({ success: false, message: "Περιμένετε λίγα δευτερόλεπτα και δοκιμάστε ξανά." }, { status: 429 });
      }
      if (outcome === "stripe_error") {
        return NextResponse.json({ success: false, message: "Το Stripe δεν απάντησε. Δοκιμάστε ξανά σε λίγο." }, { status: 502 });
      }
      const fresh = await loadContractPaymentContext(viewer!, params!.id);
      return NextResponse.json(
        { success: true, data: { outcome, payment: fresh ? await toContractPaymentDTO(fresh) : null } },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (error) {
      logError("contracts/[id]/payment/check", error);
      return serverError();
    }
  },
  "contracts.edit"
);
