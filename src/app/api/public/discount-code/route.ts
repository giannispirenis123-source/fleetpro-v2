export const dynamic = "force-dynamic";
// src/app/api/public/discount-code/route.ts
// «Εφαρμογή» εκπτωτικού κωδικού στη φόρμα κράτησης του site. Χωρίς εγγραφή.
//
// · Ο browser στέλνει ΜΟΝΟ τον κωδικό και τα κριτήρια (όχημα, ώρες, πρόσθετα)·
//   τιμή και έκπτωση ΜΟΝΟ από τον server (ίδια μηχανή με την υποβολή, που τα
//   ξαναελέγχει όλα μέσα στο κλείδωμα).
// · ΑΥΣΤΗΡΑ όρια ανά IP και ανά εταιρία (κάθε δοκιμή μετράει) → 429.
// · ΣΤΑΘΕΡΟΣ χρόνος απάντησης και ΙΔΙΑ απάντηση για «δεν υπάρχει» και «άλλης
//   εταιρίας» (το ερώτημα φιλτράρει με την εταιρία του site).
// · Ο πελάτης δεν βλέπει ΠΟΤΕ συνεργάτη ή προμήθειες: μόνο κωδικό και ποσό.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveStorefrontCompany } from "@/lib/storefront/resolve";
import { loadSiteCatalog } from "@/lib/public/site";
import { publicFormQuoteWithCode } from "@/lib/public/bookingSubmit";
import { toPublicQuote } from "@/lib/public/bookingView";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";
import { db } from "@/lib/db";
import { loadSiteCode } from "@/lib/public/siteCodeServer";
import { normalizeSiteCode, SITE_CODE_MESSAGES } from "@/lib/public/siteCode";

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
  code: z.string().max(40),
});

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** Κάθε απάντηση (σωστή, λάθος, 429) φεύγει μετά από ΤΟΥΛΑΧΙΣΤΟΝ τόσο χρόνο. */
const MIN_RESPONSE_MS = 450;

const TOO_MANY = {
  el: "Πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγα λεπτά.",
  en: "Too many attempts. Please try again in a few minutes.",
};

// POST /api/public/discount-code
export async function POST(req: NextRequest) {
  const started = Date.now();
  const reply = async (body: unknown, status = 200) => {
    const wait = MIN_RESPONSE_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return NextResponse.json(body, { status, headers: NO_STORE });
  };
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    if (!(await hitLimit(dbCounterStore, LIMITS.discountCodePerClient, ip))) return reply({ success: false, message: TOO_MANY }, 429);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return reply({ success: false, message: SITE_CODE_MESSAGES.invalid }, 400);
    const d = parsed.data;
    const resolved = await resolveStorefrontCompany(d.slug);
    if (!resolved) return reply({ success: false }, 404);
    if (!(await hitLimit(dbCounterStore, LIMITS.discountCodePerTenant, resolved.companyId))) {
      return reply({ success: false, message: TOO_MANY }, 429);
    }
    const cat = await loadSiteCatalog(resolved.companyId);
    if (!cat) return reply({ success: false }, 404);
    const wanted = normalizeSiteCode(d.code);
    // ΜΟΝΟ κωδικοί της εταιρίας του site (κωδικός άλλης εταιρίας = «δεν υπάρχει»).
    const record = wanted ? await loadSiteCode(db, resolved.companyId, wanted) : null;
    const q = publicFormQuoteWithCode(cat, d.key, d.criteria, d.extras, d.insuranceId, d.code, record);
    if (!q.ok) return reply({ success: false, message: q.message }, q.status);
    return reply({
      success: true,
      data: {
        code: q.code!.code,
        quote: toPublicQuote(q.quote, q.code, cat.ctx.settings.vatPercent),
      },
    });
  } catch (error) {
    console.error("[FleetPro] public discount code:", error instanceof Error ? error.name : "");
    return reply({ success: false }, 500);
  }
}
