// src/lib/i18n/index.ts
// Ελαφρύ σύστημα μετάφρασης — δουλεύει σε server ΚΑΙ σε client components,
// γιατί δεν κρατάει καθόλου κατάσταση: η γλώσσα δίνεται πάντα ως όρισμα.

import { el, type Dictionary } from "./el";
import { en } from "./en";
import { normalizeLocale, type Locale } from "./locale";

export { LOCALES, DEFAULT_LOCALE, isLocale, normalizeLocale } from "./locale";
export type { Locale } from "./locale";
export type { Dictionary } from "./el";

const DICTIONARIES: Record<Locale, Dictionary> = { el, en };

/** Ολόκληρο το λεξικό μιας γλώσσας (χρήσιμο όταν χρειάζονται πολλά κλειδιά). */
export function getDictionary(locale?: string | null): Dictionary {
  return DICTIONARIES[normalizeLocale(locale)];
}

/**
 * Μετάφραση με κλειδί σε μορφή "namespace.key" — π.χ. t("dashboard.alerts", "en").
 * Αν το κλειδί δεν υπάρχει, επιστρέφεται το ίδιο το κλειδί (ορατό στο UI,
 * ώστε να εντοπίζεται αμέσως αντί να εμφανίζεται κενό).
 */
export function t(key: string, locale?: string | null): string {
  const dictionary: unknown = getDictionary(locale);

  let current: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof current !== "object" || current === null) return key;
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "string" ? current : key;
}

/** Δεσμεύει τη γλώσσα μία φορά: const tr = translator(locale); tr("auth.signIn") */
export function translator(locale?: string | null) {
  const resolved = normalizeLocale(locale);
  return (key: string) => t(key, resolved);
}
