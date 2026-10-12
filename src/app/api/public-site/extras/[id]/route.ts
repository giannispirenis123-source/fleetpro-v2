export const dynamic = "force-dynamic";
// src/app/api/public-site/extras/[id]/route.ts
// Αλλαγή των ΔΗΜΟΣΙΩΝ πεδίων ενός extra (ονόματα/περιγραφές ανά γλώσσα,
// ταβάνι, ποσότητα, τύποι οχημάτων, σειρά, ενεργό). Τιμή και τρόπος χρέωσης
// αλλάζουν στη σελίδα «Πρόσθετα» (ίδιος πίνακας, ένα σημείο επεξεργασίας).
// Το ελληνικό όνομα συγχρονίζεται με το κύριο "name" (συμβόλαια, κρατήσεις).

import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { publicExtraSchema, toPublicExtraDTO } from "@/lib/public/extras";
import { fromCents } from "@/lib/public/money";

// PATCH /api/public-site/extras/[id]
export const PATCH = withPublicSite(async (req, companyId, params) => {
  try {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) return notFound();
    const current = await db.extra.findFirst({ where: { id: params.id, tenantId: companyId }, select: { id: true } });
    if (!current) return notFound("Το πρόσθετο δεν βρέθηκε");

    const parsed = publicExtraSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest(parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα", parsed.error.errors);
    }
    const d = parsed.data;
    const row = await db.extra.update({
      where: { id: current.id },
      data: {
        name: d.nameI18n.el,
        nameI18n: d.nameI18n,
        descriptionI18n: d.descriptionI18n,
        maxTotal: d.maxTotalCents === null ? null : fromCents(d.maxTotalCents),
        maxQuantity: d.maxQuantity,
        vehicleTypes: d.vehicleTypes,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
      },
    });
    return ok({ item: toPublicExtraDTO(row) });
  } catch (error) {
    console.error("[FleetPro] public-site extras PATCH:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
