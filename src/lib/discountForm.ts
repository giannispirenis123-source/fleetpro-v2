// src/lib/discountForm.ts
// Σχήμα και έλεγχοι της φόρμας εκπτώσεων, κοινά για POST και PATCH.
//
// Ζουν εδώ και όχι στο route: τα route files του Next επιτρέπουν μόνο
// συγκεκριμένα exports (GET/POST/… και λίγα config πεδία).

import { z } from "zod";
import { db } from "./db";
import { DISCOUNT_TYPES, DISCOUNT_TARGETS } from "./discountsShared";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD");

/** Κενή τιμή από τη φόρμα σημαίνει «χωρίς περιορισμό». */
const optionalDate = z.union([isoDate, z.literal(""), z.null()]).optional();
const optionalInt = z.union([z.number().int().min(0), z.null()]).optional();

export const discountFormSchema = z.object({
  code: z
    .string()
    .min(2, "Τουλάχιστον 2 χαρακτήρες")
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Μόνο γράμματα, αριθμοί, παύλα και κάτω παύλα"),
  name: z.string().min(2, "Απαιτείται όνομα"),
  type: z.enum(DISCOUNT_TYPES),
  value: z.number().positive("Η τιμή πρέπει να είναι θετική"),
  isActive: z.boolean().default(true),
  validFrom: optionalDate,
  validUntil: optionalDate,
  usageLimit: optionalInt,
  target: z.enum(DISCOUNT_TARGETS).default("ALL"),
  /** Το id πελάτη όταν target = CUSTOMER. */
  targetValue: z.union([z.string(), z.null()]).optional(),
});

export type DiscountFormData = z.infer<typeof discountFormSchema>;

/** "" ή null → null· αλλιώς μεσημέρι UTC ώστε να μην ολισθαίνει η μέρα. */
export const toDateOrNull = (v: string | null | undefined): Date | null =>
  v ? new Date(`${v}T12:00:00.000Z`) : null;

/**
 * Έλεγχοι που δεν χωρούν στο zod: ποσοστό ≤ 100, σωστή σειρά ημερομηνιών,
 * και ότι ο πελάτης-στόχος ανήκει στην ίδια εταιρία.
 */
export async function validateDiscountShape(
  data: DiscountFormData,
  tenantId: string
): Promise<string | null> {
  if (data.type === "PERCENTAGE" && data.value > 100) {
    return "Το ποσοστό δεν μπορεί να ξεπερνά το 100%";
  }

  if (data.validFrom && data.validUntil && data.validUntil < data.validFrom) {
    return "Η λήξη δεν μπορεί να προηγείται της έναρξης";
  }

  if (data.target === "CUSTOMER") {
    if (!data.targetValue) return "Επίλεξε πελάτη για τον κωδικό";

    const customer = await db.customer.findFirst({
      where: { id: data.targetValue, tenantId },
      select: { id: true },
    });
    if (!customer) return "Ο πελάτης δεν βρέθηκε";
  }

  return null;
}
