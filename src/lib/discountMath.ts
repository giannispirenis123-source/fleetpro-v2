// src/lib/discountMath.ts
// Το ποσό ενός κωδικού έκπτωσης — ΚΑΘΑΡΗ λογική (χωρίς db), ΕΝΑΣ τύπος για
// το dashboard (discounts.ts → discountAmountFor) και το δημόσιο site
// (public/siteCode.ts → κωδικοί της εταιρίας).

import { round2 } from "./pricing";

/** Ποσοστό ή σταθερό ποσό, με ανώτατο ποσό (maxDiscount) και ποτέ πάνω από τη βάση. */
export function codeAmountEuros(
  d: { type: string; value: unknown; maxDiscount?: unknown },
  baseAmount: number
): number {
  let amount = d.type === "PERCENTAGE" ? (baseAmount * Number(d.value)) / 100 : Number(d.value);
  // Ίδια συνθήκη με πριν (truthy: ένα Decimal είναι πάντα truthy).
  if (d.maxDiscount && amount > Number(d.maxDiscount)) {
    amount = Number(d.maxDiscount);
  }
  return round2(Math.max(0, Math.min(amount, baseAmount)));
}
