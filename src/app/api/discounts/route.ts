export const dynamic = "force-dynamic";
// src/app/api/discounts/route.ts
// Κωδικοί έκπτωσης ανά tenant — λίστα και δημιουργία.
// Κάθε ερώτημα φιλτράρει με discountScope: tenantId από το session ΚΑΙ, για
// συνεργάτη, μόνο οι δικοί του κωδικοί (createdById, SQL 39).

import { db } from "@/lib/db";
import { ok, created, badRequest, serverError, logError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { discountScope, partnerCommission, partnerDiscountProblem } from "@/lib/discountAccess";
import { toDiscountDTO } from "@/lib/discountMapper";
import {
  discountFormSchema,
  toDateOrNull,
  validateDiscountShape,
} from "@/lib/discountForm";

// GET /api/discounts
export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const includeInactive =
        new URL(req.url).searchParams.get("includeInactive") === "true";

      const discounts = await db.discount.findMany({
        where: {
          ...discountScope(viewer!),
          ...(includeInactive ? {} : { isActive: true }),
        },
        orderBy: { createdAt: "desc" },
      });

      return ok(discounts.map((d) => toDiscountDTO(d)));
    } catch (error) {
      logError("discounts", error);
      return serverError();
    }
  },
  "discounts.view"
);

// POST /api/discounts
export const POST = withPermission(
  async (req, session, _params, viewer) => {
    try {
      const parsed = discountFormSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;
      const problem = await validateDiscountShape(data, session.tenantId!);
      if (problem) return badRequest(problem);
      // Συνεργάτης: έκπτωση ως την προμήθειά του, μόνο ποσοστό, μόνο για όλους.
      const partnerProblem = partnerDiscountProblem(data, await partnerCommission(viewer!));
      if (partnerProblem) return badRequest(partnerProblem);

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
          // Ποιος τον δημιούργησε — πάντα από το session.
          createdById: viewer!.userId,
        },
      });

      return created({ discount: toDiscountDTO(discount) });
    } catch (error) {
      logError("discounts", error);
      return serverError();
    }
  },
  "discounts.create"
);
