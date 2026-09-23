// src/lib/discounts.ts
// Επίλυση κωδικού έκπτωσης — ΕΝΑ σημείο αλήθειας.
//
// Το χρησιμοποιούν και το /api/discounts/validate (προεπισκόπηση στη φόρμα)
// και οι routes κρατήσεων (το ποσό που όντως αποθηκεύεται), ώστε να μη
// γίνεται ποτέ να δείχνει η φόρμα άλλο ποσό από αυτό που θα γραφτεί.
//
// Server-only: εισάγει db.

import { db } from "./db";
import { round2 } from "./pricing";

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
 * Βρίσκει τον κωδικό ΜΕΣΑ στην εταιρία που δόθηκε και υπολογίζει το ποσό.
 * Το tenantId πρέπει πάντα να προέρχεται από το session του καλούντος.
 */
export async function resolveDiscountCode(opts: {
  tenantId: string;
  code: string;
  /** Το ποσό πάνω στο οποίο εφαρμόζεται η έκπτωση. */
  baseAmount: number;
  totalDays?: number;
}): Promise<DiscountResolution> {
  const discount = await db.discount.findFirst({
    where: {
      tenantId: opts.tenantId,
      code: opts.code.trim().toUpperCase(),
      isActive: true,
    },
  });

  if (!discount) {
    return { ok: false, message: "Μη έγκυρος κωδικός έκπτωσης", notFound: true };
  }

  const now = new Date();

  if (discount.validFrom && discount.validFrom > now) {
    return { ok: false, message: "Ο κωδικός δεν έχει ενεργοποιηθεί ακόμα" };
  }
  if (discount.validUntil && discount.validUntil < now) {
    return { ok: false, message: "Ο κωδικός έχει λήξει" };
  }
  if (discount.usageLimit && discount.usageCount >= discount.usageLimit) {
    return { ok: false, message: "Ο κωδικός έχει εξαντληθεί" };
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

  let amount =
    discount.type === "PERCENTAGE"
      ? (opts.baseAmount * Number(discount.value)) / 100
      : Number(discount.value);

  // Ανώτατο όριο έκπτωσης, αν έχει οριστεί.
  if (discount.maxDiscount && amount > Number(discount.maxDiscount)) {
    amount = Number(discount.maxDiscount);
  }

  // Ποτέ πάνω από το ποσό στο οποίο εφαρμόζεται.
  amount = round2(Math.max(0, Math.min(amount, opts.baseAmount)));

  return {
    ok: true,
    discount: {
      id: discount.id,
      code: discount.code ?? opts.code.trim().toUpperCase(),
      name: discount.name,
      type: discount.type,
      value: Number(discount.value),
      amount,
    },
  };
}
