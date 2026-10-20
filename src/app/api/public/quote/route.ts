export const dynamic = "force-dynamic";
// src/app/api/public/quote/route.ts
// Η τιμή της φόρμας κράτησης όταν αλλάζουν πρόσθετα/ασφάλεια — ΙΔΙΑ μηχανή
// (quote()), μόνο ids από τον browser, χωρίς εγγραφή. Μόνο δημόσια πεδία.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveStorefrontCompany } from "@/lib/storefront/resolve";
import { loadSiteCatalog } from "@/lib/public/site";
import { publicFormQuote } from "@/lib/public/bookingSubmit";
import { toPublicQuote } from "@/lib/public/bookingView";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";

const schema = z.object({
  slug: z.string().min(1).max(64),
  key: z.string().min(3).max(70),
  criteria: z.object({
    pl: z.string().max(64).nullable(),
    dl: z.string().max(64).nullable(),
    from: z.string().max(16),
    to: z.string().max(16),
    age: z.number().int().min(16).max(120).nullable(),
  }),
  extras: z.array(z.object({ id: z.string().min(1).max(64), qty: z.number().int().min(1).max(10) })).max(20).default([]),
  insuranceId: z.string().min(1).max(64).nullable().optional(),
});

const NO_STORE = { "Cache-Control": "no-store" };

// POST /api/public/quote
export async function POST(req: NextRequest) {
  try {
    // Όριο ανά IP: η τιμή υπολογίζεται χωρίς σύνδεση, άρα χωρίς φρένο θα φόρτωνε τη βάση.
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    if (!(await hitLimit(dbCounterStore, LIMITS.quotePerClient, ip))) {
      return NextResponse.json({ success: false }, { status: 429, headers: NO_STORE });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false }, { status: 400, headers: NO_STORE });
    const d = parsed.data;
    const resolved = await resolveStorefrontCompany(d.slug);
    if (!resolved) return NextResponse.json({ success: false }, { status: 404, headers: NO_STORE });
    const cat = await loadSiteCatalog(resolved.companyId);
    const q = cat ? publicFormQuote(cat, d.key, d.criteria, d.extras, d.insuranceId) : null;
    if (!q) return NextResponse.json({ success: false }, { status: 404, headers: NO_STORE });
    if (!q.ok) return NextResponse.json({ success: false, message: q.message }, { status: q.status, headers: NO_STORE });
    return NextResponse.json({ success: true, data: toPublicQuote(q.quote) }, { headers: NO_STORE });
  } catch (error) {
    console.error("[FleetPro] public quote:", error instanceof Error ? error.name : "");
    return NextResponse.json({ success: false }, { status: 500, headers: NO_STORE });
  }
}
