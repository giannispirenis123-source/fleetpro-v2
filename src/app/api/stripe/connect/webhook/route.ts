export const dynamic = "force-dynamic";
// src/app/api/stripe/connect/webhook/route.ts
// Stripe Connect webhook (events των συνδεδεμένων λογαριασμών των εταιριών).
// · Υπογραφή με STRIPE_CONNECT_WEBHOOK_SECRET πάνω στο ΑΚΑΤΕΡΓΑΣΤΟ body.
// · Η λογική (idempotency, έλεγχος εταιρίας/κράτησης/ποσού) ζει στο
//   src/lib/public/paymentWebhook.ts και ελέγχεται από τα tests.
// · Logs: μόνο τύπος event και αποτέλεσμα — ποτέ email, ονόματα, ποσά κάρτας.

import { NextRequest, NextResponse } from "next/server";
import { stripe, stripeErrorCode } from "@/lib/stripeConnect";
import { handleConnectEvent, type ConnectEvent } from "@/lib/public/paymentWebhook";
import { prismaWebhookStore } from "@/lib/public/paymentServer";

export async function POST(req: NextRequest) {
  const secret = (process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "").trim();
  if (!secret || !(process.env.STRIPE_SECRET_KEY ?? "").trim()) {
    console.error("[FleetPro] Stripe webhook: λείπει STRIPE_CONNECT_WEBHOOK_SECRET ή STRIPE_SECRET_KEY");
    return NextResponse.json({ received: false }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ received: false }, { status: 400 });

  let event: ConnectEvent;
  try {
    const raw = await req.text();
    event = stripe().webhooks.constructEvent(raw, signature, secret) as unknown as ConnectEvent;
  } catch (e) {
    console.error(`[FleetPro] Stripe webhook: άκυρη υπογραφή (${stripeErrorCode(e)})`);
    return NextResponse.json({ received: false }, { status: 400 });
  }

  try {
    const outcome = await handleConnectEvent(event, prismaWebhookStore());
    if (outcome !== "applied" && outcome !== "duplicate" && outcome !== "ignored_type") {
      console.warn(`[FleetPro] Stripe webhook ${event.type}: ${outcome}`);
    }
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // 500 → το Stripe ξαναστέλνει το event (τίποτα δεν γράφτηκε: όλα σε μία transaction).
    console.error(`[FleetPro] Stripe webhook ${event.type}: σφάλμα (${e instanceof Error ? e.name : "?"})`);
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
