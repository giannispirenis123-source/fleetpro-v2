// src/lib/discounts.ts
// Επίλυση κωδικού έκπτωσης — ΕΝΑ σημείο αλήθειας.
//
// Το χρησιμοποιούν και το /api/discounts/validate (προεπισκόπηση στη φόρμα
// και, μελλοντικά, το δημόσιο site κρατήσεων) και οι routes κρατήσεων (το
// ποσό που όντως αποθηκεύεται), ώστε να μη γίνεται ποτέ να δείχνει η φόρμα
// άλλο ποσό από αυτό που θα γραφτεί.
//
// Server-only: εισάγει db.

import type { Discount } from "@prisma/client";
import { db } from "./db";
import { round2 } from "./pricing";
import { toDiscountDTO } from "./discountMapper";
import type { DiscountDTO } from "./discountsShared";

export type { DiscountDTO };
export { toDiscountDTO };

export interface ResolvedDiscount {
  id: string;
  code: string;
  name: string;
  type: string;
  value: number;
  /** Το ποσό σε € που αφαιρείται, μετά από cap και clamp. */
  amount: number;
}

export type DiscountResolution =
  | { ok: true; discount: ResolvedDiscount }
  | { ok: false; message: string; notFound?: boolean };

/**
 * Όλοι οι έλεγχοι ισχύος σε ένα σημείο. Ένας κωδικός περνά μόνο αν
 * ικανοποιεί ΚΑΘΕ περιορισμό που έχει ορίσει ο διαχειριστής.
 *
 * Δεν αγγίζει το usageCount — η αύξηση/μείωση γίνεται μόνο όταν μια
 * κράτηση αποθηκεύεται ή ακυρώνεται (βλ. applyDiscountUsage).
 */
export function checkDiscountValidity(
  discount: Discount,
  opts: { baseAmount: number; totalDays?: number; customerId?: string | null },
  now: Date = new Date()
): { ok: true } | { ok: false; message: string } {
  if (!discount.isActive) {
    return { ok: false, message: "Ο κωδικός δεν είναι ενεργός" };
  }

  if (discount.validFrom && discount.validFrom > now) {
    return { ok: false, message: "Ο κωδικός δεν έχει ενεργοποιηθεί ακόμα" };
  }
  if (discount.validUntil && discount.validUntil < now) {
    return { ok: false, message: "Ο κωδικός έχει λήξει" };
  }

  if (discount.usageLimit !== null && discount.usageCount >= discount.usageLimit) {
    return { ok: false, message: "Εξαντλήθηκαν οι χρήσεις του κωδικού" };
  }

  // Κωδικός δεμένος σε πελάτη: ισχύει μόνο για εκείνον.
  if (discount.target === "CUSTOMER") {
    if (!discount.targetValue) {
      return {
        ok: false,
        message: "Ο κωδικός είναι δεμένος σε πελάτη αλλά δεν έχει οριστεί ποιον",
      };
    }
    if (!opts.customerId || opts.customerId !== discount.targetValue) {
      return {
        ok: false,
        message: "Ο κωδικός δεν ισχύει για αυτόν τον πελάτη",
      };
    }
  }

  if (discount.minDays && opts.totalDays && opts.totalDays < discount.minDays) {
    return {
      ok: false,
      message: `Ο κωδικός ισχύει για ενοικιάσεις τουλάχιστον ${discount.minDays} ημερών`,
    };
  }

  if (discount.minAmount && opts.baseAmount < Number(discount.minAmount)) {
    return {
      ok: false,
      message: `Ο κωδικός ισχύει για ποσά άνω των ${Number(discount.minAmount)}€`,
    };
  }

  return { ok: true };
}

/** Το ποσό της έκπτωσης, μετά από cap και clamp στη βάση. */
export function discountAmountFor(
  discount: Discount,
  baseAmount: number
): number {
  let amount =
    discount.type === "PERCENTAGE"
      ? (baseAmount * Number(discount.value)) / 100
      : Number(discount.value);

  if (discount.maxDiscount && amount > Number(discount.maxDiscount)) {
    amount = Number(discount.maxDiscount);
  }

  return round2(Math.max(0, Math.min(amount, baseAmount)));
}

/**
 * Βρίσκει τον κωδικό ΜΕΣΑ στην εταιρία που δόθηκε, τον ελέγχει και
 * υπολογίζει το ποσό. Το tenantId πρέπει πάντα να προέρχεται από το
 * session του καλούντος (ή, στο δημόσιο validate, από το αίτημα).
 */
export async function resolveDiscountCode(opts: {
  tenantId: string;
  code: string;
  baseAmount: number;
  totalDays?: number;
  /** Απαραίτητο για κωδικούς δεμένους σε πελάτη. */
  customerId?: string | null;
}): Promise<DiscountResolution> {
  const discount = await db.discount.findFirst({
    where: {
      tenantId: opts.tenantId,
      code: opts.code.trim().toUpperCase(),
    },
  });

  if (!discount) {
    return { ok: false, message: "Μη έγκυρος κωδικός έκπτωσης", notFound: true };
  }

  const check = checkDiscountValidity(discount, {
    baseAmount: opts.baseAmount,
    totalDays: opts.totalDays,
    customerId: opts.customerId,
  });
  if (!check.ok) return { ok: false, message: check.message };

  return {
    ok: true,
    discount: {
      id: discount.id,
      code: discount.code ?? opts.code.trim().toUpperCase(),
      name: discount.name,
      type: discount.type,
      value: Number(discount.value),
      amount: discountAmountFor(discount, opts.baseAmount),
    },
  };
}

/* ─────────────────────────────────────────────
   Μέτρημα χρήσεων
   ───────────────────────────────────────────── */

/**
 * Μεταφέρει μια χρήση από τον παλιό κωδικό στον νέο.
 *
 * - Ίδιος κωδικός → τίποτα, για να μη διπλομετρηθεί.
 * - Ο παλιός μειώνεται, ο νέος αυξάνεται· και τα δύο atomically με
 *   increment/decrement, ώστε ταυτόχρονες κρατήσεις να μη χάνουν μετρήσεις.
 * - Το usageCount δεν πέφτει ποτέ κάτω από 0.
 *
 * Οι κωδικοί ταυτοποιούνται με το ζεύγος (tenantId, code) που είναι unique.
 */
export async function applyDiscountUsage(opts: {
  tenantId: string;
  previousCode: string | null;
  nextCode: string | null;
}): Promise<void> {
  const prev = opts.previousCode?.trim().toUpperCase() || null;
  const next = opts.nextCode?.trim().toUpperCase() || null;

  if (prev === next) return;

  if (prev) {
    // Το updateMany με φίλτρο usageCount > 0 αποτρέπει αρνητικές τιμές
    // χωρίς να χρειάζεται πρώτα ανάγνωση.
    await db.discount.updateMany({
      where: { tenantId: opts.tenantId, code: prev, usageCount: { gt: 0 } },
      data: { usageCount: { decrement: 1 } },
    });
  }

  if (next) {
    await db.discount.updateMany({
      where: { tenantId: opts.tenantId, code: next },
      data: { usageCount: { increment: 1 } },
    });
  }
}
