// src/lib/discounts.ts
// Επίλυση κωδικού έκπτωσης — ΕΝΑ σημείο αλήθειας.
//
// Το χρησιμοποιούν οι routes κρατήσεων (προεπισκόπηση και το ποσό που όντως
// αποθηκεύεται), ώστε να μη γίνεται ποτέ να δείχνει η φόρμα άλλο ποσό από
// αυτό που θα γραφτεί. (Το παλιό /api/discounts/validate αφαιρέθηκε στο audit
// 10/2026: ήταν ανοιχτό χωρίς σύνδεση και έπαιρνε την εταιρία από το body.)
//
// Server-only: εισάγει db.

import { formatEuros } from "./public/money";
import type { Discount, Prisma } from "@prisma/client";
import { db } from "./db";
import { codeAmountEuros } from "./discountMath";
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
      message: `Ο κωδικός ισχύει για ποσά άνω των ${formatEuros(discount.minAmount, "el")}`,
    };
  }

  return { ok: true };
}

/** Το ποσό της έκπτωσης, μετά από cap και clamp στη βάση (ίδιος τύπος με το site: discountMath.ts). */
export function discountAmountFor(
  discount: Discount,
  baseAmount: number
): number {
  return codeAmountEuros(discount, baseAmount);
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
export async function applyDiscountUsage(
  opts: {
    tenantId: string;
    previousCode: string | null;
    nextCode: string | null;
  },
  /** Το κοινό `db` ή μια transaction (π.χ. κράτηση από συμβόλαιο). */
  client: Prisma.TransactionClient | typeof db = db
): Promise<void> {
  const prev = opts.previousCode?.trim().toUpperCase() || null;
  const next = opts.nextCode?.trim().toUpperCase() || null;

  if (prev === next) return;

  if (prev) {
    // Το updateMany με φίλτρο usageCount > 0 αποτρέπει αρνητικές τιμές
    // χωρίς να χρειάζεται πρώτα ανάγνωση.
    await client.discount.updateMany({
      where: { tenantId: opts.tenantId, code: prev, usageCount: { gt: 0 } },
      data: { usageCount: { decrement: 1 } },
    });
  }

  if (next) {
    await client.discount.updateMany({
      where: { tenantId: opts.tenantId, code: next },
      data: { usageCount: { increment: 1 } },
    });
  }
}

/**
 * Κρατήσεις που ΜΟΛΙΣ ακυρώθηκαν αυτόματα (έληξε / απέτυχε η online
 * πληρωμή): επιστρέφουν τη χρήση του κωδικού τους — ίδιος κανόνας με την
 * ακύρωση από το dashboard («ΜΟΝΟ η ακύρωση ελευθερώνει τη χρήση»).
 * Καλείται ΜΕΤΑ την αλλαγή σε CANCELLED, με τα ids που άλλαξαν.
 */
export async function releaseDiscountUsageFor(
  client: Pick<Prisma.TransactionClient, "booking" | "discount">,
  tenantId: string,
  bookingIds: string[]
): Promise<void> {
  if (bookingIds.length === 0) return;
  const rows = await client.booking.findMany({
    where: { tenantId, id: { in: bookingIds }, status: "CANCELLED", discountCode: { not: null } },
    select: { discountCode: true },
  });
  for (const r of rows) {
    await applyDiscountUsage({ tenantId, previousCode: r.discountCode, nextCode: null }, client as Prisma.TransactionClient);
  }
}

/**
 * Ο συνεργάτης απενεργοποιήθηκε / έπαψε να είναι συνεργάτης / διαγράφεται:
 * οι κωδικοί που του ΑΝΑΤΕΘΗΚΑΝ απενεργοποιούνται. Δεν γίνονται ΠΟΤΕ σιωπηλά
 * «κωδικοί της εταιρίας» (η έκπτωση θα έβγαινε από την εταιρία).
 */
export async function deactivatePartnerCodes(
  client: Pick<Prisma.TransactionClient, "discount">,
  tenantId: string,
  partnerId: string
): Promise<number> {
  const r = await client.discount.updateMany({
    where: { tenantId, isActive: true, OR: [{ partnerId }, { createdById: partnerId }] },
    data: { isActive: false },
  });
  return r.count;
}
