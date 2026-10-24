export const dynamic = "force-dynamic";
// src/app/api/public/founding-spots/route.ts
// GET /api/public/founding-spots — ΜΟΝΟ ο αριθμός θέσεων που απομένουν στο
// πρόγραμμα «Πρώτες 10 εταιρίες» ({ remaining }). Ποτέ ποιες εταιρίες, ποτέ
// κωδικοί. Όριο ανά IP (κοινό LIMITS). Κλειστή εγγραφή ή Billing → 404 / 0.

import { NextRequest, NextResponse } from "next/server";
import { selfSignupEnabled } from "@/lib/signup/flag";
import { clientIp } from "@/lib/signup/request";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";
import { billingReady } from "@/lib/billing/billingServer";
import { publicSpotsBody } from "@/lib/billing/founding";
import { foundingRemaining } from "@/lib/billing/foundingServer";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export async function GET(req: NextRequest) {
  if (!selfSignupEnabled()) return NextResponse.json({ message: "Δεν βρέθηκε" }, { status: 404, headers: HEADERS });
  try {
    if (!(await hitLimit(dbCounterStore, LIMITS.foundingSpotsPerIp, clientIp(req)))) {
      return NextResponse.json({ message: "Πολλές προσπάθειες" }, { status: 429, headers: HEADERS });
    }
    const remaining = billingReady() ? await foundingRemaining() : 0;
    return NextResponse.json(publicSpotsBody(remaining), { headers: HEADERS });
  } catch (e) {
    console.error(`[FleetPro] founding-spots: ${e instanceof Error ? e.name : "error"}`);
    return NextResponse.json({ message: "Σφάλμα" }, { status: 500, headers: HEADERS });
  }
}
