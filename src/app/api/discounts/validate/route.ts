export const dynamic = "force-dynamic";
// src/app/api/discounts/validate/route.ts
// Επαλήθευση κωδικού έκπτωσης — προεπισκόπηση για τη φόρμα κράτησης.
//
// Η ΑΠΑΝΤΗΣΗ ΕΔΩ ΕΙΝΑΙ ΕΝΔΕΙΚΤΙΚΗ. Το ποσό που αποθηκεύεται το ξαναβγάζει
// ο server στο /api/bookings με τα ίδια δεδομένα, μέσω της ίδιας
// resolveDiscountCode — ώστε να μη γίνεται να διαφέρουν.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, badRequest, notFound, serverError } from "@/lib/api";
import { resolveDiscountCode } from "@/lib/discounts";

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

    const { code, tenantId, totalAmount, totalDays } = parsed.data;

    const result = await resolveDiscountCode({
      tenantId,
      code,
      baseAmount: totalAmount ?? 0,
      totalDays,
    });

    if (!result.ok) {
      return result.notFound
        ? notFound(result.message)
        : badRequest(result.message);
    }

    const { amount, ...discount } = result.discount;

    return ok({
      valid: true,
      discount,
      discountAmount: amount,
      message: `Εφαρμόστηκε έκπτωση "${discount.name}"`,
    });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}
