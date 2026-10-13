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
import { defaultsToClear } from "@/lib/public/insuranceDefaults";

// PATCH /api/public-site/extras/[id]
export const PATCH = withPublicSite(async (req, companyId, params) => {
  try {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) return notFound();
    const current = await db.extra.findFirst({ where: { id: params.id, tenantId: companyId }, select: { id: true, type: true } });
    if (!current) return notFound("Το πρόσθετο δεν βρέθηκε");

    const parsed = publicExtraSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest(parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα", parsed.error.errors);
    }
    const d = parsed.data;
    // Προεπιλογή υπάρχει ΜΟΝΟ για ασφάλειες.
    const isDefault = current.type === "INSURANCE" && d.isDefault;

    const row = await db.$transaction(async (tx) => {
      const saved = await tx.extra.update({
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
        isDefault,
      },
      });
      // Το πολύ ΜΙΑ προεπιλεγμένη ασφάλεια ανά τύπο οχήματος: όσες άλλες
      // καλύπτουν κοινό τύπο παύουν να είναι προεπιλογή (η τελευταία κερδίζει).
      if (isDefault) {
        const others = await tx.extra.findMany({
          where: { tenantId: companyId, type: "INSURANCE", isDefault: true, NOT: { id: saved.id } },
          select: { id: true, type: true, isDefault: true, vehicleTypes: true },
        });
        const clear = defaultsToClear(saved, others);
        if (clear.length > 0) {
          await tx.extra.updateMany({ where: { tenantId: companyId, id: { in: clear } }, data: { isDefault: false } });
        }
      }
      return saved;
    });
    const changed = await db.extra.findMany({
      where: { tenantId: companyId },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    return ok({ item: toPublicExtraDTO(row), items: changed.map(toPublicExtraDTO) });
  } catch (error) {
    console.error("[FleetPro] public-site extras PATCH:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
