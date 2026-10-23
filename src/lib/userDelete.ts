// src/lib/userDelete.ts
// Οριστική διαγραφή χρήστη εταιρίας — ΜΟΝΟ server. Κανόνες: canHardDelete
// (adminRole.ts). Όλα σε ΜΙΑ transaction:
//
//  · Οι ιστορικές εγγραφές ΜΕΝΟΥΝ: κρατήσεις (createdById/partnerId → NULL με
//    το FK + σημάδι createdByDeleted/partnerDeleted), συμβόλαια (όνομα-snapshot
//    και id σβήνονται + createdByDeleted), χειροκίνητη τιμή συμβολαίου (όνομα
//    και id βγαίνουν από το snapshot), activity_logs (userId → NULL με το FK),
//    αποστολές μηνυμάτων, «κρατήθηκε από», νομικά κείμενα (id → NULL).
//  · Σβήνονται μαζί με τη γραμμή: sessions και tokens επαλήθευσης (FK CASCADE),
//    δικαιώματα (ζουν στη γραμμή).
//  · Το email ελευθερώνεται (η γραμμή φεύγει).
// Κάθε ερώτημα φιλτράρει με το tenantId του Διαχειριστή.

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { refreshSearchText } from "./contractForm";
import { DELETE_MSG, canHardDelete, isCompanyAdmin, type RoleActor, type RoleDecision } from "./adminRole";

/** Οι ΑΛΛΟΙ ενεργοί διαχειριστές, με κλείδωμα (δύο ταυτόχρονες διαγραφές δεν αφήνουν 0). */
async function lockedOtherAdmins(tx: Prisma.TransactionClient, tenantId: string, exceptId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "users"
    WHERE "tenantId" = ${tenantId} AND "role" = 'COMPANY_ADMIN'::"UserRole" AND "isActive" = true
    FOR UPDATE
  `);
  return rows.filter((r) => r.id !== exceptId).length;
}

export async function hardDeleteCompanyUser(actor: RoleActor, targetId: string): Promise<RoleDecision> {
  const tenantId = actor.tenantId;
  // Staff/Partner/Super Admin → 403 πριν από οποιοδήποτε ερώτημα.
  if (!isCompanyAdmin(actor) || !tenantId) return { ok: false, status: 403, message: DELETE_MSG.onlyAdmin };

  return db.$transaction(async (tx) => {
    const target = await tx.user.findFirst({
      where: { id: targetId, tenantId },
      select: { id: true, role: true, tenantId: true, isActive: true },
    });
    const others = target?.role === "COMPANY_ADMIN" ? await lockedOtherAdmins(tx, tenantId, target.id) : 1;
    const decision = canHardDelete(actor, target, others);
    if (!decision.ok || !target) return decision;
    const id = target.id;

    await tx.booking.updateMany({ where: { tenantId, createdById: id }, data: { createdByDeleted: true, createdById: null } });
    await tx.booking.updateMany({ where: { tenantId, partnerId: id }, data: { partnerDeleted: true, partnerId: null } });
    const contracts = await tx.contract.findMany({ where: { tenantId, createdById: id }, select: { id: true } });
    await tx.contract.updateMany({
      where: { tenantId, createdById: id },
      data: { createdById: null, createdByName: null, createdByDeleted: true },
    });
    // Το κείμενο αναζήτησης κρατούσε το όνομα του συντάκτη → ξανά χωρίς αυτό.
    for (const c of contracts) await refreshSearchText(c.id, tx);
    // Χειροκίνητη τιμή συμβολαίου: όνομα + id έξω από το snapshot, σημάδι userDeleted.
    await tx.$executeRaw`
      UPDATE "contracts"
      SET "snapshot" = jsonb_set(("snapshot" #- '{priceOverride,userName}') #- '{priceOverride,userId}',
                                 '{priceOverride,userDeleted}', 'true'::jsonb)
      WHERE "tenantId" = ${tenantId} AND "snapshot"->'priceOverride'->>'userId' = ${id}`;
    await tx.bookingNotification.updateMany({ where: { tenantId, userId: id }, data: { userId: null } });
    await tx.bookingPayment.updateMany({ where: { tenantId, retainedBy: id }, data: { retainedBy: null } });
    await tx.siteLegalText.updateMany({ where: { tenantId, createdById: id }, data: { createdById: null } });
    // activity_logs.userId → NULL από το FK (SQL 35)· sessions/tokens → CASCADE.
    await tx.user.delete({ where: { id } });
    return decision;
  });
}
