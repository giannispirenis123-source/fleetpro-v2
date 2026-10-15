export const dynamic = "force-dynamic";
// src/app/api/public-site/quote/route.ts
// «Δοκιμαστικός υπολογισμός» (dashboard): ίδια quote() με το site (PR 2–3),
// με δεδομένα από τη βάση της εταιρίας της συνεδρίας. Ο browser στέλνει ΜΟΝΟ
// ids και επιλογές — κανένα ποσό.

import { z } from "zod";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { computeQuoteForTenant } from "@/lib/public/quoteServer";

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

    // Η ΙΔΙΑ συνάρτηση με κράτηση/συμβόλαιο και το site (computeQuoteForTenant).
    const out = await computeQuoteForTenant(companyId, (ctx) => {
      const kind = (eid: string) => ctx.extras.find((e) => e.id === eid)?.kind;
      return {
        target: input.target,
        pickupAt: input.pickupAt,
        dropoffAt: input.dropoffAt,
        pickupLocationId: input.pickupLocationId ?? null,
        dropoffLocationId: input.dropoffLocationId ?? null,
        driverAge: input.driverAge ?? null,
        extras: input.extras.filter((e) => kind(e.id) === "EXTRA"),
        // Ίδια σύμβαση με το site: χωρίς επιλογή → η προεπιλεγμένη ασφάλεια.
        insuranceId: input.insuranceId === undefined ? undefined : input.insuranceId,
        now: new Date(),
      };
    });
    if (!out.ok) return notFound("Η ομάδα ή το όχημα δεν βρέθηκε");
    const result = out.result;
    return ok(result);
  } catch (error) {
    console.error("[FleetPro] public-site quote:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
