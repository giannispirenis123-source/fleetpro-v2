// src/lib/prepTime.ts
// Χρόνος προετοιμασίας οχήματος: αποθηκεύεται σε λεπτά, εμφανίζεται σε
// ώρες + λεπτά μόλις ξεπεράσει τα 59.

/** Ανώτατο όριο: 24 ώρες. Πάνω από αυτό δεν είναι «προετοιμασία». */
export const MAX_PREP_MINUTES = 1440;

/**
 * 0 → "0λ", 45 → "45λ", 60 → "1ω", 75 → "1ω 15λ", 120 → "2ω".
 * Στα Αγγλικά: "45m", "1h", "1h 15m", "2h".
 */
export function formatPrepTime(minutes: number, locale: string): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;

  const hourUnit = locale === "en" ? "h" : "ω";
  const minUnit = locale === "en" ? "m" : "λ";

  if (h === 0) return `${m}${minUnit}`;
  if (m === 0) return `${h}${hourUnit}`;
  return `${h}${hourUnit} ${m}${minUnit}`;
}

/** Σπάει τα λεπτά σε ώρες + λεπτά, για τα δύο πεδία της φόρμας. */
export function splitPrepTime(minutes: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.round(minutes));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** Ενώνει ώρες + λεπτά σε σύνολο λεπτών, με κόψιμο στο ανώτατο όριο. */
export function joinPrepTime(hours: number, minutes: number): number {
  const total = Math.max(0, hours) * 60 + Math.max(0, minutes);
  return Math.min(MAX_PREP_MINUTES, Math.round(total));
}
