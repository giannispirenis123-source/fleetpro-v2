export const dynamic = "force-dynamic";
// src/app/api/public-site/insurance/route.ts
// «Επίπεδα ασφάλειας» της εταιρίας = γραμμές του extras με type INSURANCE
// (src/lib/public/insuranceLevels.ts). ΜΟΝΟ Διαχειριστής με πακέτο publicSite
// (withPublicSite)· εταιρία ΜΟΝΟ από τη συνεδρία. Ποσά σε cents στο API.

import { db } from "@/lib/db";
import { badRequest, created, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { fromCents } from "@/lib/public/money";
import { insuranceLevelSchema } from "@/lib/public/insuranceLevels";
import { listInsuranceLevels as listLevels } from "@/lib/public/insuranceLevelsServer";


// GET /api/public-site/insurance
export const GET = withPublicSite(async (_req, companyId) => {
  try {
    return ok({ items: await listLevels(companyId) });
  } catch (error) {
    console.error("[FleetPro] insurance GET:", error instanceof Error ? error.name : "");
    return serverError();
  }
});

// POST /api/public-site/insurance — νέο επίπεδο (στο τέλος της λίστας)
export const POST = withPublicSite(async (req, companyId) => {
  try {
    const parsed = insuranceLevelSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα", parsed.error.errors);
    const d = parsed.data;
    const last = await db.extra.aggregate({ where: { tenantId: companyId, type: "INSURANCE" }, _max: { sortOrder: true } });
    await db.extra.create({
      data: {
        tenantId: companyId,
        type: "INSURANCE",
        name: d.nameI18n.el,
        nameI18n: d.nameI18n,
        descriptionI18n: d.descriptionI18n,
        coveragesI18n: d.coveragesI18n,
        price: fromCents(d.priceCents),
        chargeType: d.chargeType,
        maxTotal: d.maxTotalCents === null ? null : fromCents(d.maxTotalCents),
        excess: d.excessCents === null ? null : fromCents(d.excessCents),
        vehicleTypes: d.vehicleTypes,
        isActive: d.isActive,
        isDefault: false,
        maxQuantity: 1,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    return created({ items: await listLevels(companyId) });
  } catch (error) {
    console.error("[FleetPro] insurance POST:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
