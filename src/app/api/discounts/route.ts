export const dynamic = "force-dynamic";
// src/app/api/discounts/route.ts
// Κωδικοί έκπτωσης ανά tenant — λίστα και δημιουργία.
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από το session.

import { db } from "@/lib/db";
import { ok, created, badRequest, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { toDiscountDTO } from "@/lib/discountMapper";
import {
  discountFormSchema,
  toDateOrNull,
  validateDiscountShape,
} from "@/lib/discountForm";

// GET /api/discounts
export const GET = withPermission(
  async (req, session) => {
    try {
      const includeInactive =
        new URL(req.url).searchParams.get("includeInactive") === "true";

      const discounts = await db.discount.findMany({
        where: {
          tenantId: session.tenantId!,
          ...(includeInactive ? {} : { isActive: true }),
        },
        orderBy: { createdAt: "desc" },
      });

      return ok(discounts.map((d) => toDiscountDTO(d)));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "discounts.view"
);

// POST /api/discounts
export const POST = withPermission(
  async (req, session) => {
    try {
      const parsed = discountFormSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;
      const problem = await validateDiscountShape(data, session.tenantId!);
      if (problem) return badRequest(problem);

      const code = data.code.trim().toUpperCase();

      const existing = await db.discount.findFirst({
        where: { tenantId: session.tenantId!, code },
        select: { id: true },
      });
      if (existing) return badRequest("Ο κωδικός υπάρχει ήδη");

      const discount = await db.discount.create({
        data: {
          tenantId: session.tenantId!,
          code,
          name: data.name.trim(),
          type: data.type,
          value: data.value,
          isActive: data.isActive,
          validFrom: toDateOrNull(data.validFrom),
          validUntil: toDateOrNull(data.validUntil),
          usageLimit: data.usageLimit ?? null,
          target: data.target,
          targetValue: data.target === "CUSTOMER" ? data.targetValue! : null,
        },
      });

      return created({ discount: toDiscountDTO(discount) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "discounts.create"
);
