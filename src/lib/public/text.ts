// src/lib/public/text.ts
// Κείμενα εταιρίας ανά κωδικό γλώσσας ({"el":"…","en":"…"}) — καθαρή λογική.
//
// Fallback: ζητούμενη γλώσσα → en → el → πρώτη διαθέσιμη → "".

export type LocalizedText = Record<string, string>;

export function textFor(text: unknown, lang: string): string {
  if (!text || typeof text !== "object" || Array.isArray(text)) return "";
  const t = text as Record<string, unknown>;
  for (const code of [lang, "en", "el"]) {
    const v = t[code];
    if (typeof v === "string" && v.trim()) return v;
  }
  for (const v of Object.values(t)) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

/** Από JSON της βάσης σε καθαρό {γλώσσα: κείμενο} (κενά/άκυρα έξω). */
export function readLocalized(value: unknown, max = 2000): LocalizedText {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: LocalizedText = {};
  for (const [code, v] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z]{2}$/.test(code) || typeof v !== "string") continue;
    const s = v.trim().slice(0, max);
    if (s) out[code] = s;
  }
  return out;
}

/** Όριο γραμμών στη λίστα καλύψεων μιας ασφάλειας (και μήκος γραμμής). */
export const COVERAGES_MAX = 20;
export const COVERAGE_LEN = 120;

/**
 * Λίστα κειμένων ανά γλώσσα (π.χ. καλύψεις ασφάλειας) από JSON της βάσης:
 * μόνο αντικείμενα με τουλάχιστον ένα κείμενο, έως `maxItems`.
 */
export function readLocalizedList(value: unknown, maxItems = COVERAGES_MAX, maxLen = COVERAGE_LEN): LocalizedText[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => readLocalized(v, maxLen))
    .filter((t) => Object.keys(t).length > 0)
    .slice(0, maxItems);
}
