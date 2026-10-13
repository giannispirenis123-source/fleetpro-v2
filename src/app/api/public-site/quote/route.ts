export const dynamic = "force-dynamic";
// src/app/api/public-site/quote/route.ts
// «Δοκιμαστικός υπολογισμός» (dashboard): ίδια quote() με το site (PR 2–3),
// με δεδομένα από τη βάση της εταιρίας της συνεδρίας. Ο browser στέλνει ΜΟΝΟ
// ids και επιλογές — κανένα ποσό.

import { z } from "zod";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { quote } from "@/lib/public/pricing";
import { loadQuoteContext } from "@/lib/public/server";

const id = z.string().min(1).max(64);
const schema = z.object({
  target: z.object({ kind: z.enum(["group", "vehicle"]), id }),
  pickupAt: z.string().max(16),
  dropoffAt: z.string().max(16),
  pickupLocationId: id.nullable().optional(),
  dropoffLocationId: id.nullable().optional(),
  driverAge: z.number().int().min(16).max(120).nullable().optional(),
  extras: z.array(z.object({ id, qty: z.number().int().min(0).max(10) })).max(30).default([]),
  insuranceId: id.nullable().optional(),
});

// POST /api/public-site/quote
export const POST = withPublicSite(async (req, companyId) => {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest("Μη έγκυρα στοιχεία υπολογισμού", parsed.error.errors);
    const input = parsed.data;

    const ctx = await loadQuoteContext(companyId);
    if (!ctx) return notFound();
    const subject = (input.target.kind === "group" ? ctx.groups : ctx.vehicles).get(input.target.id);
    if (!subject) return notFound("Η ομάδα ή το όχημα δεν βρέθηκε");

    const location = (lid?: string | null) => (lid ? ctx.locations.find((l) => l.id === lid && l.isActive) ?? null : null);
    const extraOf = (eid: string, kind: "EXTRA" | "INSURANCE") =>
      ctx.extras.find((e) => e.id === eid && e.kind === kind && e.isActive);

    const result = quote({
      pickupAt: input.pickupAt,
      dropoffAt: input.dropoffAt,
      target: subject.target,
      rates: subject.rates,
      seasons: ctx.seasons,
      pickupLocation: location(input.pickupLocationId),
      dropoffLocation: location(input.dropoffLocationId) ?? location(input.pickupLocationId),
      driverAge: input.driverAge ?? null,
      ageBands: ctx.ageBands,
      extras: input.extras.flatMap((e) => {
        const charge = extraOf(e.id, "EXTRA");
        return charge ? [{ charge, qty: e.qty }] : [];
      }),
      insurance: input.insuranceId ? extraOf(input.insuranceId, "INSURANCE") ?? null : null,
      promotions: ctx.promotions,
      settings: ctx.settings,
      now: new Date(),
    });
    return ok(result);
  } catch (error) {
    console.error("[FleetPro] public-site quote:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
