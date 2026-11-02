export const dynamic = "force-dynamic";
// src/app/api/discounts/[id]/route.ts
// Επεξεργασία και ήπια απενεργοποίηση κωδικού έκπτωσης.
// Κάθε ερώτημα φιλτράρει με discountScope: tenantId από το session ΚΑΙ, για
// συνεργάτη, μόνο οι δικοί του κωδικοί — κωδικός άλλου → 404 (ούτε ότι υπάρχει).

import { db } from "@/lib/db";
import { ok, badRequest, notFound, serverError, logError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { discountScope, partnerCommission, partnerDiscountProblem } from "@/lib/discountAccess";
import { toDiscountDTO } from "@/lib/discountMapper";
import {
  discountFormSchema,
  toDateOrNull,
  validateDiscountShape,
} from "@/lib/discountForm";

// PATCH /api/discounts/[id]
export const PATCH = withPermission(
  async (req, session, params, viewer) => {
    try {
      const current = await db.discount.findFirst({
        where: { id: params!.id, ...discountScope(viewer!) },
      });
      if (!current) return notFound("Ο κωδικός δεν βρέθηκε");

      const parsed = discountFormSchema.partial().safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      // Οι διασταυρούμενοι έλεγχοι θέλουν την ΤΕΛΙΚΗ εικόνα, όχι μόνο ό,τι
      // στάλθηκε: αλλιώς μια αλλαγή μόνο της λήξης δεν θα ελεγχόταν ως προς
      // την υπάρχουσα έναρξη.
      const merged = {
        code: parsed.data.code ?? current.code ?? "",
        name: parsed.data.name ?? current.name,
        type: parsed.data.type ?? (current.type as "PERCENTAGE" | "FIXED_AMOUNT"),
        value: parsed.data.value ?? Number(current.value),
        isActive: parsed.data.isActive ?? current.isActive,
        validFrom:
          parsed.data.validFrom !== undefined
            ? parsed.data.validFrom
            : current.validFrom?.toISOString().slice(0, 10) ?? null,
        validUntil:
          parsed.data.validUntil !== undefined
            ? parsed.data.validUntil
            : current.validUntil?.toISOString().slice(0, 10) ?? null,
        usageLimit:
          parsed.data.usageLimit !== undefined
            ? parsed.data.usageLimit
            : current.usageLimit,
        target:
          parsed.data.target ?? (current.target === "CUSTOMER" ? "CUSTOMER" : "ALL"),
        targetValue:
          parsed.data.targetValue !== undefined
            ? parsed.data.targetValue
            : current.targetValue,
      } as const;

      const problem = await validateDiscountShape(
        merged as never,
        session.tenantId!
      );
      if (problem) return badRequest(problem);
      // Συνεργάτης: ο ενεργός κωδικός του μένει ως την προμήθειά του (η
      // απενεργοποίηση επιτρέπεται πάντα).
      if (merged.isActive) {
        const partnerProblem = partnerDiscountProblem(merged, await partnerCommission(viewer!));
        if (partnerProblem) return badRequest(partnerProblem);
      }

      // Αλλαγή κωδικού: πρέπει να μείνει μοναδικός μέσα στην εταιρία.
      const nextCode = merged.code.trim().toUpperCase();
      if (nextCode !== current.code) {
        const clash = await db.discount.findFirst({
          where: { tenantId: session.tenantId!, code: nextCode },
          select: { id: true },
        });
        if (clash) return badRequest("Ο κωδικός υπάρχει ήδη");
      }

      const discount = await db.discount.update({
        where: { id: current.id },
        data: {
          code: nextCode,
          name: merged.name.trim(),
          type: merged.type,
          value: merged.value,
          isActive: merged.isActive,
          validFrom: toDateOrNull(merged.validFrom),
          validUntil: toDateOrNull(merged.validUntil),
          usageLimit: merged.usageLimit ?? null,
          target: merged.target,
          targetValue: merged.target === "CUSTOMER" ? merged.targetValue : null,
        },
      });

      return ok({ discount: toDiscountDTO(discount) });
    } catch (error) {
      logError("discounts/[id]", error);
      return serverError();
    }
  },
  "discounts.edit"
);

// DELETE /api/discounts/[id] — απενεργοποίηση, όχι σβήσιμο.
// Ο κωδικός μένει στη βάση ώστε κρατήσεις που τον χρησιμοποίησαν να
// κρατούν νόημα, και για να διατηρηθεί το ιστορικό χρήσεων.
export const DELETE = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const current = await db.discount.findFirst({
        where: { id: params!.id, ...discountScope(viewer!) },
      });
      if (!current) return notFound("Ο κωδικός δεν βρέθηκε");

      if (!current.isActive) {
        return badRequest("Ο κωδικός είναι ήδη ανενεργός");
      }

      const discount = await db.discount.update({
        where: { id: current.id },
        data: { isActive: false },
      });

      return ok({ discount: toDiscountDTO(discount) });
    } catch (error) {
      logError("discounts/[id]", error);
      return serverError();
    }
  },
  "discounts.delete"
);
