// src/app/api/discounts/validate/route.ts
// Επαλήθευση κωδικού έκπτωσης

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, badRequest, notFound, serverError } from "@/lib/api";

const validateSchema = z.object({
  code: z.string(),
  tenantId: z.string(),
  totalAmount: z.number().optional(),
  totalDays: z.number().optional(),
  vehicleCategory: z.string().optional(),
  vehicleId: z.string().optional(),
  customerId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = validateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Μη έγκυρα δεδομένα");
    }

    const { code, tenantId, totalAmount, totalDays, vehicleCategory, vehicleId, customerId } =
      parsed.data;

    const discount = await db.discount.findFirst({
      where: {
        tenantId,
        code: code.toUpperCase(),
        isActive: true,
      },
    });

    if (!discount) {
      return notFound("Μη έγκυρος κωδικός έκπτωσης");
    }

    const now = new Date();

    // Έλεγχος ημερομηνίας
    if (discount.validFrom && discount.validFrom > now) {
      return badRequest("Ο κωδικός δεν έχει ενεργοποιηθεί ακόμα");
    }
    if (discount.validUntil && discount.validUntil < now) {
      return badRequest("Ο κωδικός έχει λήξει");
    }

    // Έλεγχος χρήσεων
    if (discount.usageLimit && discount.usageCount >= discount.usageLimit) {
      return badRequest("Ο κωδικός έχει εξαντληθεί");
    }

    // Έλεγχος ελάχιστων ημερών
    if (discount.minDays && totalDays && totalDays < discount.minDays) {
      return badRequest(
        `Ο κωδικός ισχύει για ενοικιάσεις τουλάχιστον ${discount.minDays} ημερών`
      );
    }

    // Έλεγχος ελάχιστου ποσού
    if (discount.minAmount && totalAmount && totalAmount < Number(discount.minAmount)) {
      return badRequest(
        `Ο κωδικός ισχύει για παραγγελίες άνω των ${discount.minAmount}€`
      );
    }

    // Υπολογισμός έκπτωσης
    let discountAmount = 0;
    if (totalAmount) {
      if (discount.type === "PERCENTAGE") {
        discountAmount = (totalAmount * Number(discount.value)) / 100;
      } else {
        discountAmount = Number(discount.value);
      }

      // Cap έκπτωσης
      if (discount.maxDiscount && discountAmount > Number(discount.maxDiscount)) {
        discountAmount = Number(discount.maxDiscount);
      }

      // Να μην ξεπερνά το σύνολο
      discountAmount = Math.min(discountAmount, totalAmount);
    }

    return ok({
      valid: true,
      discount: {
        id: discount.id,
        code: discount.code,
        name: discount.name,
        type: discount.type,
        value: Number(discount.value),
      },
      discountAmount: Math.round(discountAmount * 100) / 100,
      message: `Εφαρμόστηκε έκπτωση "${discount.name}"`,
    });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}
\nexport const dynamic = "force-dynamic";
