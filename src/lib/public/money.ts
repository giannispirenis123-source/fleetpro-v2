// src/lib/public/money.ts
// Χρήματα του δημόσιου site — ΕΝΑ σημείο μετατροπής € ↔ cents.
//
// · Οι νέοι πίνακες (rental_groups, pickup_locations, rates, driver_age_bands)
//   κρατούν ακέραια λεπτά (cents), με ΦΠΑ.
// · Οι παλιοί (vehicles.dailyRate, extras.price/excess/maxTotal) μένουν σε €
//   (Decimal)· μετατρέπονται ΕΔΩ όταν φορτώνονται για τη quote().
// · Η φόρμα δέχεται € με κόμμα ή τελεία («35,50») και αποθηκεύει cents.
//
// Καθαρή λογική, χωρίς imports: τη φορτώνουν server, client και tests.

/** Decimal (Prisma) / number / κείμενο σε € → ακέραια λεπτά. Άκυρο → 0. */
export function toCents(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Όπως toCents, αλλά null μένει null (π.χ. «χωρίς ταβάνι»). */
export const toCentsOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : toCents(value);

/** Λεπτά → € (για αποθήκευση σε Decimal στήλες). */
export const fromCents = (cents: number): number => Math.round(cents) / 100;

/**
 * Ό,τι πληκτρολόγησε ο χρήστης σε € → cents. Δέχεται «35», «35,5», «35.50»,
 * «1.234,50». Κενό → null. Άκυρο → NaN (ο καλών δείχνει σφάλμα).
 */
export function parseEuroInput(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, "");
  if (s === "") return null;
  // «1.234,50» → «1234.50»· «35,5» → «35.5»· «35.50» → «35.50».
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 100);
}

/** Cents → κείμενο για input («35,50», «35»). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const euros = cents / 100;
  return Number.isInteger(euros) ? String(euros) : euros.toFixed(2).replace(".", ",");
}

/** Cents → «35,50 €» / «€35.50» ανάλογα με τη γλώσσα. */
export function formatCents(cents: number, lang = "el"): string {
  const euros = cents / 100;
  try {
    return new Intl.NumberFormat(lang === "el" ? "el-GR" : lang, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: Number.isInteger(euros) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(euros);
  } catch {
    return `${euros.toFixed(2)} €`;
  }
}
