export const dynamic = "force-dynamic";
// src/app/api/public-site/[resource]/[id]/move/route.ts
// «Πάνω/Κάτω» για όσα έχουν σειρά (μέρη, κριτικές): ξανααριθμεί 0, 1, 2…
// μόνο τις εγγραφές ΤΗΣ ΕΤΑΙΡΙΑΣ της συνεδρίας. Επιστρέφει όλη τη λίστα.

import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { RESOURCES, isResource } from "@/lib/public/resources";
import { moveLevel } from "@/lib/public/insuranceLevels";

const schema = z.object({ dir: z.enum(["up", "down"]) });
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// POST /api/public-site/[resource]/[id]/move  { dir: "up" | "down" }
export const POST = withPublicSite(async (req, companyId, params) => {
  try {
    if (!isResource(params.resource) || !ID_RE.test(params.id)) return notFound();
    const def = RESOURCES[params.resource];
    if (!def.movable) return notFound();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα");

    const rows: { id: string; sortOrder: number }[] = await def.delegate().findMany({
      where: { tenantId: companyId },
      select: { id: true, sortOrder: true },
      orderBy: def.orderBy,
    });
    if (!rows.some((r) => r.id === params.id)) return notFound();
    // Ίδια σειρά με τη λίστα (και για όσα είχαν ίδιο sortOrder).
    const ranked = rows.map((r, i) => ({ id: r.id, sortOrder: i }));
    const changes = moveLevel(ranked, params.id, parsed.data.dir);
    const all = rows.map((r, i) => ({ id: r.id, sortOrder: changes.find((c) => c.id === r.id)?.sortOrder ?? i }))
      .filter((r, i) => r.sortOrder !== rows[i].sortOrder);
    if (all.length > 0) {
      await db.$transaction(
        all.map((c) => (def.delegate() as unknown as { updateMany(a: unknown): never }).updateMany({ where: { id: c.id, tenantId: companyId }, data: { sortOrder: c.sortOrder } }))
      );
    }
    const fresh = await def.delegate().findMany({
      where: { tenantId: companyId },
      orderBy: def.orderBy,
      ...(def.include && { include: def.include }),
    });
    return ok({ items: fresh.map(def.toDTO) });
  } catch (error) {
    console.error(`[FleetPro] public-site ${params.resource} move:`, error instanceof Error ? error.name : "");
    return serverError();
  }
});
