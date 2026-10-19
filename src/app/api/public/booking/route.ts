export const dynamic = "force-dynamic";
// src/app/api/public/booking/route.ts
// Δημόσια υποβολή κράτησης (χωρίς login). Η εταιρία ΜΟΝΟ από το slug
// (resolveStorefrontCompany)· όλοι οι έλεγχοι, η τιμή και η διαθεσιμότητα
// ξανά στον server (src/lib/public/bookingSubmit.ts). Ποσά από τον browser
// δεν διαβάζονται. Καμία IP δεν αποθηκεύεται.

import { NextRequest, NextResponse } from "next/server";
import { submitPublicBooking } from "@/lib/public/bookingSubmit";
import { publicOrigin } from "@/lib/bookingDecisionServer";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

// POST /api/public/booking
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const r = await submitPublicBooking(body, new Date(), publicOrigin(req));
    if (r.ok) return NextResponse.json({ success: true, data: { code: r.code, url: r.url } }, { status: 201, headers: NO_STORE });
    return NextResponse.json(
      { success: false, message: r.message, fieldErrors: r.fieldErrors ?? [], ageUpdate: r.ageUpdate ?? null },
      { status: r.status, headers: NO_STORE }
    );
  } catch (error) {
    console.error("[FleetPro] public booking:", error instanceof Error ? error.name : "");
    return NextResponse.json(
      { success: false, message: { el: "Κάτι πήγε στραβά. Δοκιμάστε ξανά.", en: "Something went wrong. Please try again." } },
      { status: 500, headers: NO_STORE }
    );
  }
}
