// src/lib/i18n/locale.ts
// Ο τύπος της γλώσσας, χωρίς εξαρτήσεις από λεξικά.
// Ξεχωριστό αρχείο ώστε το middleware (edge runtime) να μη φορτώνει
// ολόκληρα τα dictionaries μόνο για να ελέγξει μια τιμή. Οι γλώσσες βγαίνουν
// από ΤΟ κεντρικό σημείο (languages.ts).

import { LANGUAGE_CODES, type LanguageCode } from "./languages";

export type Locale = LanguageCode;

export const LOCALES: readonly Locale[] = LANGUAGE_CODES;

export const DEFAULT_LOCALE: Locale = "el";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Επιστρέφει πάντα έγκυρη γλώσσα — Ελληνικά όπου λείπει ή δεν αναγνωρίζεται. */
export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
