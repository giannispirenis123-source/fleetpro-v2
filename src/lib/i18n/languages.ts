// src/lib/i18n/languages.ts
// ΤΟ κεντρικό σημείο των γλωσσών — dashboard ΚΑΙ δημόσιο site. Χωρίς imports
// (το φορτώνουν middleware/edge, server, browser και tests).
//
// Νέα γλώσσα = ΜΙΑ γραμμή εδώ + τα λεξικά της:
//   · dashboard: src/lib/i18n/<code>.ts και καταχώριση στο src/lib/i18n/index.ts
//   · site: λεξικό στο src/lib/storefront/i18n.ts (DICTIONARIES)
// Το όνομα γράφεται ΣΤΗ ΔΙΚΗ ΤΗΣ γλώσσα (Ελληνικά, English, Deutsch…).

export const LANGUAGES = [
  { code: "el", name: "Ελληνικά", short: "ΕΛ" },
  { code: "en", name: "English", short: "EN" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const LANGUAGE_CODES: readonly LanguageCode[] = LANGUAGES.map((l) => l.code);

/** Το όνομα της γλώσσας στη δική της γλώσσα· άγνωστος κωδικός → ο κωδικός με κεφαλαία. */
export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

/** Σύντομη μορφή (ΕΛ, EN) για στενά σημεία. */
export function languageShort(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.short ?? code.toUpperCase();
}
