export const dynamic = "force-dynamic";
// src/app/api/public-site/insurance/[id]/route.ts
// Επεξεργασία / διαγραφή ενός επιπέδου ασφάλειας. Διαγραφή επιπέδου που
// χρησιμοποιήθηκε σε κράτηση = ΑΠΕΝΕΡΓΟΠΟΙΗΣΗ (οι αποθηκευμένες αναλύσεις
// των κρατήσεων μένουν ανέπαφες).

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { fromCents } from "@/lib/public/money";
import { deleteActionFor, insuranceLevelSchema } from "@/lib/public/insuranceLevels";
import { listInsuranceLevels as listLevels } from "@/lib/public/insuranceLevelsServer";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const findLevel = (companyId: string, id: string) =>
  db.extra.findFirst({ where: { id, tenantId: companyId, type: "INSURANCE" }, select: { id: true } });

// PATCH /api/public-site/insurance/[id]
export const PATCH = withPublicSite(async (req, companyId, params) => {
  try {
    if (!ID_RE.test(params.id)) return notFound();
    const current = await findLevel(companyId, params.id);
    if (!current) return notFound("Το επίπεδο δεν βρέθηκε");
    const parsed = insuranceLevelSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα", parsed.error.errors);
    const d = parsed.data;
    await db.extra.update({
      where: { id: current.id },
      data: {
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
      },
    });
    return ok({ items: await listLevels(companyId) });
  } catch (error) {
    console.error("[FleetPro] insurance PATCH:", error instanceof Error ? error.name : "");
    return serverError();
  }
});

// DELETE /api/public-site/insurance/[id]
export const DELETE = withPublicSite(async (_req, companyId, params) => {
  try {
    if (!ID_RE.test(params.id)) return notFound();
    const current = await findLevel(companyId, params.id);
    if (!current) return notFound("Το επίπεδο δεν βρέθηκε");
    // Χρησιμοποιήθηκε; (snapshot πρόσθετων ή ανάλυση τιμής κάποιας κράτησης της εταιρίας)
    const needle = `%"${current.id}"%`;
    const [{ n }] = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*) AS n FROM "bookings"
      WHERE "tenantId" = ${companyId}
        AND ("extras"::text LIKE ${needle} OR COALESCE("priceQuote"::text, '') LIKE ${needle})
    `);
    const action = deleteActionFor(Number(n));
    if (action === "deactivate") {
      await db.extra.update({ where: { id: current.id }, data: { isActive: false } });
    } else {
      await db.extra.delete({ where: { id: current.id } });
    }
    return ok({ action, items: await listLevels(companyId) });
  } catch (error) {
    console.error("[FleetPro] insurance DELETE:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
