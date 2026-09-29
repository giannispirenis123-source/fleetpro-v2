export const dynamic = "force-dynamic";
// src/app/api/super-admin/platform-discounts/route.ts
// Εκπτώσεις στη ΣΥΝΔΡΟΜΗ εταιριών — μόνο Super Admin.
// Άσχετο με τις εκπτώσεις κρατήσεων (/api/discounts).

import { db } from "@/lib/db";
import {
  withAuth,
  ok,
  created,
  badRequest,
  conflict,
  notFound,
  serverError,
} from "@/lib/api";
import { toPlatformDiscountDTO } from "@/lib/platformDiscounts";
import {
  platformDiscountSchema,
  platformDiscountInclude,
  findOverlappingDiscount,
  toPlatformDiscountRow,
  firstIssue,
} from "@/lib/platformDiscountsForm";

// GET /api/super-admin/platform-discounts — όλες οι εκπτώσεις συνδρομής
export const GET = withAuth(async () => {
  try {
    const rows = await db.platformDiscount.findMany({
      include: platformDiscountInclude,
      orderBy: [{ active: "desc" }, { validFrom: "desc" }],
    });
    return ok({ discounts: rows.map(toPlatformDiscountDTO) });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);

// POST /api/super-admin/platform-discounts — νέα έκπτωση σε μία εταιρία
export const POST = withAuth(async (req) => {
  try {
    const body = await req.json().catch(() => null);
    const parsed = platformDiscountSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(firstIssue(parsed.error), parsed.error.errors);
    }
    const data = parsed.data;

    const tenant = await db.tenant.findUnique({
      where: { id: data.tenantId },
      select: { id: true },
    });
    if (!tenant) return notFound("Η εταιρία δεν βρέθηκε");

    if (data.active) {
      const overlap = await findOverlappingDiscount(data);
      if (overlap) {
        return conflict(
          "Η εταιρία έχει ήδη ενεργή έκπτωση που επικαλύπτεται με αυτό το διάστημα. Απενεργοποίησέ την ή άλλαξε τις ημερομηνίες.",
          { id: overlap.id }
        );
      }
    }

    const row = await db.platformDiscount.create({
      data: toPlatformDiscountRow(data),
      include: platformDiscountInclude,
    });
    return created(toPlatformDiscountDTO(row));
  } catch (error) {
    console.error(error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);
