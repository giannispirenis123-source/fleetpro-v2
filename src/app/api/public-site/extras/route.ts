export const dynamic = "force-dynamic";
// src/app/api/public-site/extras/route.ts
// Extras & ασφάλειες για το site: ο ΥΠΑΡΧΩΝ πίνακας extras (όχι νέος).
// Τα ποσά επιστρέφονται σε cents (μετατροπή μέσω money.ts)· στη βάση μένουν €.

import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { toPublicExtraDTO } from "@/lib/public/extras";

// GET /api/public-site/extras
export const GET = withPublicSite(async (_req, companyId) => {
  try {
    const rows = await db.extra.findMany({
      where: { tenantId: companyId },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    return ok({ items: rows.map(toPublicExtraDTO) });
  } catch (error) {
    console.error("[FleetPro] public-site extras GET:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
