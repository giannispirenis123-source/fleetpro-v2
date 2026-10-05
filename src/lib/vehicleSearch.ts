// src/lib/vehicleSearch.ts
// Αναζήτηση οχήματος στον client (μάρκα, μοντέλο, πινακίδα) — καθαρή
// λογική, χωρίς runtime imports (client + tests).
//
//  · Χωρίς τόνους, πεζά/κεφαλαία ίδια.
//  · Πινακίδα χωρίς κενά/παύλες/τελείες: «ΧΑΝ1234» = «ΧΑΝ-1234» = «xan 1234».
//  · Ελληνικά/λατινικά ομοιόγραφα ίδια (Α/A, Β/B, Ε/E, Ζ/Z, Η/H, Ι/I, Κ/K,
//    Μ/M, Ν/N, Ο/O, Ρ/P, Τ/T, Υ/Y, Χ/X) — οι πινακίδες γράφονται και με τα δύο.

const ACCENTS: Record<string, string> = {
  ά: "α", έ: "ε", ή: "η", ί: "ι", ό: "ο", ύ: "υ", ώ: "ω", ϊ: "ι", ϋ: "υ", ΐ: "ι", ΰ: "υ", ς: "σ",
};

const LOOKALIKE: Record<string, string> = {
  α: "a", β: "b", ε: "e", ζ: "z", η: "h", ι: "i", κ: "k", μ: "m",
  ν: "n", ο: "o", ρ: "p", τ: "t", υ: "y", χ: "x",
};

/** Πεζά, χωρίς τόνους/διακριτικά, ομοιόγραφα → λατινικά. Τα κενά μένουν. */
export function foldVehicleText(input: string): string {
  let out = "";
  for (const raw of input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()) {
    const ch = ACCENTS[raw] ?? raw;
    out += LOOKALIKE[ch] ?? ch;
  }
  return out;
}

/** Κλειδί πινακίδας: μόνο γράμματα/ψηφία, ομοιόγραφα ενοποιημένα. */
export const plateKey = (plate: string) => foldVehicleText(plate).replace(/[^\p{L}\p{N}]+/gu, "");

export interface SearchableVehicle {
  brand: string;
  model: string;
  plate: string;
}

/**
 * Ταιριάζει: (α) η πινακίδα περιέχει το ερώτημα (χωρίς σύμβολα), ή (β) κάθε
 * λέξη του ερωτήματος βρίσκεται σε μάρκα/μοντέλο/πινακίδα. Ελάχιστο 1 χαρακτήρας.
 */
export function vehicleMatches(v: SearchableVehicle, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const key = plateKey(q);
  if (key && plateKey(v.plate).includes(key)) return true;
  const hay = `${foldVehicleText(v.brand)} ${foldVehicleText(v.model)} ${plateKey(v.plate)}`;
  return foldVehicleText(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w.replace(/[^\p{L}\p{N}]+/gu, "")));
}

/** Τα οχήματα που ταιριάζουν, με τη σειρά που ήρθαν. */
export const searchVehicles = <T extends SearchableVehicle>(list: T[], query: string, limit?: number) => {
  const out = list.filter((v) => vehicleMatches(v, query));
  return limit ? out.slice(0, limit) : out;
};
