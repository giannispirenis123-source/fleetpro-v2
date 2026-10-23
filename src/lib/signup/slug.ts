// src/lib/signup/slug.ts
// Slug από το όνομα της εταιρίας στην εγγραφή — καθαρή λογική (tests χωρίς βάση).
//
// · Λατινοποίηση ελληνικών (απλοποιημένο ΕΛΟΤ 743: θ→th, χ→ch, ψ→ps, ου→ou,
//   μπ→mp, ντ→nt, γκ→gk, γγ→ng), χωρίς τόνους, πεζά, παύλες.
// · Ίδιοι κανόνες με το slug της σελίδας (validateSlug: 3–40, δεσμευμένες
//   λέξεις). Δεσμευμένη/κοντή βάση → παίρνει επίθεμα.
// · Μοναδικότητα: base, base-2, base-3, … (η τελική κρίση είναι του UNIQUE
//   index· ο καλών ξαναδοκιμάζει σε σύγκρουση).

import { SLUG_MAX, SLUG_MIN, validateSlug } from "../storefront/slug";

const DIGRAPHS: [string, string][] = [
  ["ου", "ou"],
  ["μπ", "mp"],
  ["ντ", "nt"],
  ["γκ", "gk"],
  ["γγ", "ng"],
  ["τσ", "ts"],
  ["τζ", "tz"],
];

const LETTERS: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i",
  κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s",
  ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/** Ελληνικά (και τονισμένα λατινικά) → λατινικά πεζά. */
export function transliterate(input: string): string {
  // Πρώτα πεζά + αφαίρεση τόνων/διαλυτικών (ά→α, ϊ→ι, é→e).
  let s = input.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  for (const [gr, lat] of DIGRAPHS) s = s.split(gr).join(lat);
  return Array.from(s, (ch) => LETTERS[ch] ?? ch).join("");
}

/** Όνομα → μορφή slug (μπορεί να είναι κενό/κοντό/δεσμευμένο — βλ. slugBase). */
export function slugify(name: string, max = SLUG_MAX): string {
  return transliterate(name)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** Χώρος για επίθεμα "-NN" ώστε το σύνολο να μένει ≤ SLUG_MAX. */
const SUFFIX_ROOM = 4;

/**
 * Η βάση για τη μοναδικότητα: πάντα έγκυρη ΜΟΡΦΗ. Κενό → "company", κοντό →
 * "<x>-rent". Αν είναι δεσμευμένη, μένει ως έχει: το uniqueSlug τη
 * «περνά» με επίθεμα (admin → admin-2).
 */
export function slugBase(name: string): string {
  let base = slugify(name, SLUG_MAX - SUFFIX_ROOM);
  if (!base) base = "company";
  if (base.length < SLUG_MIN) base = `${base}-rent`;
  return base;
}

/** Η σειρά υποψηφίων: base, base-2, base-3, … (χωρίς δεσμευμένα/άκυρα). */
export function slugCandidates(base: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 1; out.length < count && i < count + 50; i++) {
    const cand = i === 1 ? base : `${base.slice(0, SLUG_MAX - String(i).length - 1).replace(/-+$/g, "")}-${i}`;
    if (validateSlug(cand).ok) out.push(cand);
  }
  return out;
}

/**
 * Πρώτο ελεύθερο slug. `isTaken` ρωτά τη βάση (και τα δύο slug της εταιρίας).
 * Μετά από `tries` συγκρούσεις: τυχαίο επίθεμα (πρακτικά πάντα ελεύθερο).
 */
export async function uniqueSlug(
  name: string,
  isTaken: (slug: string) => Promise<boolean>,
  tries = 20,
  random: () => string = () => Math.random().toString(36).slice(2, 7)
): Promise<string> {
  const base = slugBase(name);
  for (const cand of slugCandidates(base, tries)) {
    if (!(await isTaken(cand))) return cand;
  }
  const head = base.slice(0, SLUG_MAX - 6).replace(/-+$/g, "");
  return `${head}-${random().replace(/[^a-z0-9]/g, "").slice(0, 5) || "x"}`;
}
