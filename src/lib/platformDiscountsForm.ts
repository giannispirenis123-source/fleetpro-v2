// src/lib/platformDiscountsForm.ts
// Σχήμα και έλεγχοι για τις εκπτώσεις συνδρομής (Super Admin), κοινά για
// POST και PATCH.
//
// Ζουν εδώ και όχι στο route: τα route files του Next επιτρέπουν μόνο
// συγκεκριμένα exports (GET/POST/… και λίγα config πεδία).
//
// Server-only: εισάγει db.

import { z } from "zod";
import { db } from "./db";
import { PLATFORM_DISCOUNT_TYPES, dateOnly, parseDateOnly } from "./platformDiscounts";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD")
  // Απορρίπτει και ό,τι «γυρίζει» ο Date (π.χ. 2026-02-30 → 2026-03-02).
  .refine((s) => {
    const d = parseDateOnly(s);
    return !Number.isNaN(d.getTime()) && dateOnly(d) === s;
  }, "Μη έγκυρη ημερομηνία");

/** Κενή λήξη από τη φόρμα = ισχύει μέχρι να διακοπεί. */
const optionalDate = z
  .union([isoDate, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const optionalNote = z
  .union([z.string().max(500, "Έως 500 χαρακτήρες"), z.null()])
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

export const platformDiscountSchema = z
  .object({
    tenantId: z.string().min(1, "Επίλεξε εταιρία"),
    type: z.enum(PLATFORM_DISCOUNT_TYPES),
    value: z.number().positive("Η τιμή πρέπει να είναι μεγαλύτερη από 0"),
    validFrom: isoDate,
    validUntil: optionalDate,
    active: z.boolean().default(true),
    note: optionalNote,
  })
  .superRefine((d, ctx) => {
    if (d.type === "PERCENTAGE" && d.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Το ποσοστό δεν μπορεί να ξεπερνά το 100%",
      });
    }
    if (d.validUntil && d.validUntil < d.validFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "Η λήξη δεν μπορεί να προηγείται της έναρξης",
      });
    }
  });

export type PlatformDiscountData = z.infer<typeof platformDiscountSchema>;

/** Πρώτο μήνυμα σφάλματος του zod, για απάντηση 400. */
export function firstIssue(error: z.ZodError): string {
  return error.errors[0]?.message ?? "Μη έγκυρα δεδομένα";
}

/**
 * Υπάρχει άλλη ΕΝΕΡΓΗ έκπτωση της ίδιας εταιρίας που επικαλύπτεται χρονικά;
 * Διαστήματα κλειστά: [validFrom, validUntil ή ∞]. Επιστρέφει την πρώτη.
 */
export async function findOverlappingDiscount(
  data: Pick<PlatformDiscountData, "tenantId" | "validFrom" | "validUntil">,
  excludeId?: string
) {
  const from = parseDateOnly(data.validFrom);
  const until = data.validUntil ? parseDateOnly(data.validUntil) : null;

  return db.platformDiscount.findFirst({
    where: {
      tenantId: data.tenantId,
      active: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      // η υπάρχουσα αρχίζει πριν τελειώσει η νέα…
      ...(until ? { validFrom: { lte: until } } : {}),
      // …και τελειώνει μετά την αρχή της νέας (ή δεν τελειώνει ποτέ)
      OR: [{ validUntil: null }, { validUntil: { gte: from } }],
    },
    orderBy: { validFrom: "asc" },
  });
}

/** Τα δεδομένα της φόρμας σε μορφή για create/update της Prisma. */
export function toPlatformDiscountRow(data: PlatformDiscountData) {
  return {
    tenantId: data.tenantId,
    type: data.type,
    value: data.value,
    validFrom: parseDateOnly(data.validFrom),
    validUntil: data.validUntil ? parseDateOnly(data.validUntil) : null,
    active: data.active,
    note: data.note,
  };
}

export const platformDiscountInclude = {
  tenant: { select: { name: true, plan: true } },
} as const;
