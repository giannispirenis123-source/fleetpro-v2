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

/* ─────────────────────────────────────────────
   ΕΝΑ σημείο μορφοποίησης ποσών (cents → κείμενο)
   ─────────────────────────────────────────────
   Κάθε ποσό που βλέπει πελάτης ή έγγραφο (email, WhatsApp, PDF, σελίδες
   /booking, /c/, site, Stripe) και το dashboard περνά ΜΟΝΟ από εδώ. Χωρίς Intl:
   ίδιο αποτέλεσμα σε server και browser, ανεξάρτητα από την έκδοση ICU.
   · el: «180 €», «1.180,50 €» (τελεία χιλιάδων, κόμμα δεκαδικών, € μετά)
   · en (και κάθε άλλη γλώσσα): «€180», «€1,180.50»
   · Αρνητικό: «−15,50 €» (U+2212). Μη αριθμός → «—» (ποτέ ψεύτικο ποσό). */

export interface MoneyFormat {
  /** "auto" (προεπιλογή): «180 €» / «180,50 €» · "always": πάντα 2 δεκαδικά («180,00 €» — έγγραφα). */
  decimals?: "auto" | "always";
  /** Απλό κενό αντί για μη αλλάξιμο (τα PDF fonts δεν έχουν U+00A0). */
  plainSpace?: boolean;
}

/** Ανώτατο λογικό σύνολο μιας κράτησης/εγγράφου (cents) — βλ. verifyOutgoingAmounts / quote. */
export const MAX_TOTAL_CENTS = 5_000_000; // 50.000 €

const group = (digits: string, sep: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);

export function formatMoney(cents: number, lang = "el", opts: MoneyFormat = {}): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  const c = Math.round(cents);
  const abs = Math.abs(c);
  const intPart = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, "0");
  const showDec = opts.decimals === "always" || frac !== "00";
  const space = opts.plainSpace ? " " : "\u00a0";
  const minus = c < 0 ? "\u2212" : "";
  if (lang === "el" || lang.startsWith("el-")) {
    return `${minus}${group(intPart, ".")}${showDec ? `,${frac}` : ""}${space}€`;
  }
  return `${minus}€${group(intPart, ",")}${showDec ? `.${frac}` : ""}`;
}

/** Όπως formatMoney, με είσοδο € (Decimal/number) — μετατρέπεται σε cents ΕΔΩ. */
export const formatEuros = (euros: unknown, lang = "el", opts: MoneyFormat = {}): string =>
  euros === null || euros === undefined || !Number.isFinite(Number(String(euros)))
    ? formatMoney(NaN, lang, opts)
    : formatMoney(toCents(euros), lang, opts);

/** Cents → «35,50 €» / «€35.50» (παλιό όνομα — ίδιο με formatMoney). */
export function formatCents(cents: number, lang = "el"): string {
  return formatMoney(cents, lang);
}

/**
 * Στρογγυλοποίηση στο πλησιέστερο ΑΚΕΡΑΙΟ € (σε cents), half up: 12,50 → 13,
 * 12,49 → 12. Για αρνητικά (εκπτώσεις) στρογγυλεύει το μέτρο: −12,50 → −13.
 * Ο ΕΝΑΣ κανόνας για κάθε παράγωγη γραμμή και για το τελικό σύνολο.
 */
export function roundToEuro(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  const sign = cents < 0 ? -1 : 1;
  // +1e-9: προστασία από 1249.9999… που προκύπτει από πράξεις με δεκαδικά.
  return sign * Math.floor((Math.abs(cents) + 50 + 1e-9) / 100) * 100;
}

/**
 * «€/ημέρα» από το ΣΥΝΟΛΟ: σύνολο ÷ ημέρες στο πλησιέστερο €. `approx` =
 * δεν βγαίνει ακριβώς (η κάρτα δείχνει «~»). Η αλήθεια είναι το σύνολο.
 */
export function perDayOf(totalCents: number, days: number): { cents: number; approx: boolean } {
  const d = Math.max(1, Math.floor(days));
  const cents = roundToEuro(totalCents / d);
  return { cents, approx: cents * d !== totalCents };
}

/**
 * Το ΑΠΟΘΗΚΕΥΜΕΝΟ σύνολο μιας κράτησης σε cents: priceQuote.totalCents, αλλιώς
 * (παλιά κράτηση) το bookings.total. ΠΟΤΕ νέος υπολογισμός την ώρα της αποστολής.
 */
export function storedTotalCents(priceQuote: unknown, total: unknown): number {
  const q = priceQuote && typeof priceQuote === "object" ? (priceQuote as { totalCents?: unknown }) : {};
  return typeof q.totalCents === "number" && Number.isFinite(q.totalCents) ? Math.round(q.totalCents) : toCents(total);
}
