export const dynamic = "force-dynamic";
// src/app/api/public-site/[resource]/route.ts
// Δημόσιο site — λίστα / δημιουργία για: groups, locations, seasons, age-bands
// (καταχωρητής: src/lib/public/resources.ts). Μόνο Διαχειριστής + publicSite.
// Η εταιρία ΠΑΝΤΑ από τη συνεδρία.

import { Prisma } from "@prisma/client";
import { badRequest, created, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { RESOURCES, isResource } from "@/lib/public/resources";

const firstError = (e: { errors: { message: string }[] }) => e.errors[0]?.message ?? "Μη έγκυρα δεδομένα";

// GET /api/public-site/[resource]
export const GET = withPublicSite(async (_req, companyId, params) => {
  try {
    if (!isResource(params.resource)) return notFound();
    const def = RESOURCES[params.resource];
    const rows = await def.delegate().findMany({
      where: { tenantId: companyId },
      orderBy: def.orderBy,
      ...(def.include && { include: def.include }),
    });
    return ok({ items: rows.map(def.toDTO) });
  } catch (error) {
    console.error(`[FleetPro] public-site ${params.resource} GET:`, error instanceof Error ? error.name : "");
    return serverError();
  }
});

// POST /api/public-site/[resource]
export const POST = withPublicSite(async (req, companyId, params) => {
  try {
    if (!isResource(params.resource)) return notFound();
    const def = RESOURCES[params.resource];
    const parsed = def.schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(firstError(parsed.error), parsed.error.errors);

    const problem = def.check ? await def.check(companyId, parsed.data, null) : null;
    if (problem) return badRequest(problem);

    try {
      const row = await def.delegate().create({
        data: { ...(def.toData ? def.toData(parsed.data, "create") : parsed.data), tenantId: companyId },
        ...(def.include && { include: def.include }),
      });
      await def.afterSave?.(companyId, row);
      return created({ item: def.toDTO(row) });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return badRequest(def.uniqueMessage ?? "Υπάρχει ήδη εγγραφή με αυτά τα στοιχεία");
      }
      throw e;
    }
  } catch (error) {
    console.error(`[FleetPro] public-site ${params.resource} POST:`, error instanceof Error ? error.name : "");
    return serverError();
  }
});
