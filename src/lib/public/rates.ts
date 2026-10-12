// src/lib/public/rates.ts
// Κλίμακες τιμής (tiers) — καθαρός έλεγχος, για server, client και tests.

import type { Tier } from "./pricing";

export const MAX_TIERS = 10;

/**
 * Έγκυρες κλίμακες: ταξινομημένες από 1 ημέρα και πάνω, χωρίς επικάλυψη,
 * «έως» ≥ «από», μόνο η τελευταία χωρίς άνω όριο, τιμή > 0.
 * Επιστρέφει μήνυμα σφάλματος ή null.
 */
export function tiersProblem(tiers: Tier[]): string | null {
  if (tiers.length > MAX_TIERS) return `Έως ${MAX_TIERS} κλίμακες`;
  const sorted = [...tiers].sort((a, b) => a.minDays - b.minDays);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (!Number.isInteger(t.minDays) || t.minDays < 1) return "Οι ημέρες ξεκινούν από 1";
    if (t.maxDays !== null && (!Number.isInteger(t.maxDays) || t.maxDays < t.minDays)) {
      return `Κλίμακα από ${t.minDays}: το «έως» πρέπει να είναι ≥ «από»`;
    }
    if (!Number.isInteger(t.dailyPriceCents) || t.dailyPriceCents <= 0) {
      return `Κλίμακα από ${t.minDays}: η τιμή ανά ημέρα πρέπει να είναι πάνω από 0`;
    }
    const next = sorted[i + 1];
    if (next) {
      if (t.maxDays === null) return "Μόνο η τελευταία κλίμακα μπορεί να μην έχει «έως»";
      if (next.minDays <= t.maxDays) return `Οι κλίμακες ${t.minDays}–${t.maxDays} και από ${next.minDays} επικαλύπτονται`;
    }
  }
  return null;
}
