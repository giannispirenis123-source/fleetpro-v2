export const dynamic = "force-dynamic";
// src/app/api/billing/webhook/route.ts
// Stripe Billing webhook (συνδρομές εταιριών στην πλατφόρμα). ΞΕΧΩΡΙΣΤΟ
// endpoint και secret από το Connect (/api/stripe/connect/webhook).
// · Υπογραφή με STRIPE_BILLING_WEBHOOK_SECRET πάνω στο ΑΚΑΤΕΡΓΑΣΤΟ body.
// · Η λογική (idempotency, έλεγχος εταιρίας, έκπτωση ιδρυτή) ζει στο
//   src/lib/billing/webhook.ts και ελέγχεται από τα tests.
// · Logs: μόνο τύπος event και αποτέλεσμα.

import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripeConnect";
import { billingConfig, billingErrorCode, prismaBillingDeps } from "@/lib/billing/billingServer";
import { handleBillingEvent, type BillingEvent } from "@/lib/billing/webhook";

export async function POST(req: NextRequest) {
  const secret = (process.env.STRIPE_BILLING_WEBHOOK_SECRET ?? "").trim();
  if (!secret || !billingConfig().ready) {
    console.error("[FleetPro] Billing webhook: το Billing δεν είναι ρυθμισμένο (δες τα logs εκκίνησης)");
    return NextResponse.json({ received: false }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ received: false }, { status: 400 });

  let event: BillingEvent;
  try {
    const raw = await req.text();
    event = stripe().webhooks.constructEvent(raw, signature, secret) as unknown as BillingEvent;
  } catch (e) {
    console.error(`[FleetPro] Billing webhook: άκυρη υπογραφή (${billingErrorCode(e)})`);
    return NextResponse.json({ received: false }, { status: 400 });
  }

  try {
    const outcome = await handleBillingEvent(event, prismaBillingDeps());
    if (!["applied", "duplicate", "ignored_type", "noop"].includes(outcome)) {
      console.warn(`[FleetPro] Billing webhook ${event.type}: ${outcome}`);
    }
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // 500 → το Stripe ξαναστέλνει (και κρατά το draft τιμολόγιο έως 72 ώρες).
    console.error(`[FleetPro] Billing webhook ${event.type}: σφάλμα (${billingErrorCode(e)})`);
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
