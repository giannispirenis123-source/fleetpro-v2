export const dynamic = "force-dynamic";
// src/app/api/public-site/insurance/[id]/move/route.ts
// Σειρά επιπέδων ασφάλειας: πάνω/κάτω (ίδια σειρά στο site και στο dashboard).

import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { moveLevel } from "@/lib/public/insuranceLevels";
import { listInsuranceLevels as listLevels } from "@/lib/public/insuranceLevelsServer";

const schema = z.object({ dir: z.enum(["up", "down"]) });

export const POST = withPublicSite(async (req, companyId, params) => {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα");
    const levels = await db.extra.findMany({
      where: { tenantId: companyId, type: "INSURANCE" },
      select: { id: true, sortOrder: true },
    });
    if (!levels.some((l) => l.id === params.id)) return notFound("Το επίπεδο δεν βρέθηκε");
    const changes = moveLevel(levels, params.id, parsed.data.dir);
    if (changes.length > 0) {
      await db.$transaction(
        changes.map((c) => db.extra.updateMany({ where: { id: c.id, tenantId: companyId }, data: { sortOrder: c.sortOrder } }))
      );
    }
    return ok({ items: await listLevels(companyId) });
  } catch (error) {
    console.error("[FleetPro] insurance move:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
