// src/lib/i18n/locale.ts
// Ο τύπος της γλώσσας, χωρίς εξαρτήσεις από λεξικά.
// Ξεχωριστό αρχείο ώστε το middleware (edge runtime) να μη φορτώνει
// ολόκληρα τα dictionaries μόνο για να ελέγξει μια τιμή.

export type Locale = "el" | "en";

export const LOCALES: readonly Locale[] = ["el", "en"] as const;

export const DEFAULT_LOCALE: Locale = "el";

export function isLocale(value: unknown): value is Locale {
  return value === "el" || value === "en";
}

/** Επιστρέφει πάντα έγκυρη γλώσσα — Ελληνικά όπου λείπει ή δεν αναγνωρίζεται. */
export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
