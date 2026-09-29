export const dynamic = "force-dynamic";
// src/app/api/super-admin/platform-discounts/[id]/route.ts
// Επεξεργασία / διακοπή / διαγραφή έκπτωσης συνδρομής — μόνο Super Admin.

import { db } from "@/lib/db";
import {
  withAuth,
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  noContent,
} from "@/lib/api";
import { toPlatformDiscountDTO } from "@/lib/platformDiscounts";
import {
  platformDiscountSchema,
  platformDiscountInclude,
  findOverlappingDiscount,
  toPlatformDiscountRow,
  firstIssue,
} from "@/lib/platformDiscountsForm";

// PATCH — μερική ενημέρωση. Συγχωνεύεται με την αποθηκευμένη εγγραφή και
// ξαναελέγχεται ΟΛΟΚΛΗΡΗ, ώστε π.χ. νέα λήξη να συγκρίνεται με την παλιά έναρξη.
export const PATCH = withAuth(
  async (req, _session, params) => {
    try {
      const existing = await db.platformDiscount.findUnique({
        where: { id: params!.id },
        include: platformDiscountInclude,
      });
      if (!existing) return notFound("Η έκπτωση δεν βρέθηκε");

      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return badRequest("Μη έγκυρα δεδομένα");
      }

      const current = toPlatformDiscountDTO(existing);
      const parsed = platformDiscountSchema.safeParse({
        tenantId: current.tenantId,
        type: current.type,
        value: current.value,
        validFrom: current.validFrom,
        validUntil: current.validUntil,
        active: current.active,
        note: current.note,
        ...body,
      });
      if (!parsed.success) {
        return badRequest(firstIssue(parsed.error), parsed.error.errors);
      }
      const data = parsed.data;

      if (data.tenantId !== existing.tenantId) {
        const tenant = await db.tenant.findUnique({
          where: { id: data.tenantId },
          select: { id: true },
        });
        if (!tenant) return notFound("Η εταιρία δεν βρέθηκε");
      }

      if (data.active) {
        const overlap = await findOverlappingDiscount(data, existing.id);
        if (overlap) {
          return conflict(
            "Η εταιρία έχει ήδη ενεργή έκπτωση που επικαλύπτεται με αυτό το διάστημα. Απενεργοποίησέ την ή άλλαξε τις ημερομηνίες.",
            { id: overlap.id }
          );
        }
      }

      const row = await db.platformDiscount.update({
        where: { id: existing.id },
        data: toPlatformDiscountRow(data),
        include: platformDiscountInclude,
      });
      return ok(toPlatformDiscountDTO(row));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["SUPER_ADMIN"]
);

// DELETE — οριστική διαγραφή (για «διακοπή» χρησιμοποιείται PATCH active=false)
export const DELETE = withAuth(
  async (_req, _session, params) => {
    try {
      const existing = await db.platformDiscount.findUnique({
        where: { id: params!.id },
        select: { id: true },
      });
      if (!existing) return notFound("Η έκπτωση δεν βρέθηκε");

      await db.platformDiscount.delete({ where: { id: existing.id } });
      return noContent();
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["SUPER_ADMIN"]
);
