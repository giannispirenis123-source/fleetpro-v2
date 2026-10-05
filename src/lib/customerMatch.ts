// src/lib/customerMatch.ts
// Αναγνώριση παλιού πελάτη στο συμβόλαιο — καθαρή λογική, χωρίς runtime
// imports (τη φορτώνουν server, client και τα tests).
//
//  · Ανοχή σε τόνους/διαλυτικά, κεφαλαία/πεζά, τελικό σίγμα.
//  · Τηλέφωνο σε ψηφία, χωρίς κενά/σύμβολα και χωρίς +30/0030.
//  · Ο server κάνει ένα ευρύ φίλτρο σε SQL με τον ΙΔΙΟ χάρτη χαρακτήρων
//    (FOLD_FROM → FOLD_TO στο translate()) και την τελική απόφαση την παίρνει
//    το `customerMatches` εδώ — μία πηγή αλήθειας, με tests.

/* ─────────────────────────────────────────────
   Κανονικοποίηση
   ───────────────────────────────────────────── */

const FOLD_PAIRS: [string, string][] = [
  // Ελληνικά με τόνο/διαλυτικά (πεζά και κεφαλαία) και τελικό σίγμα.
  ["ά", "α"], ["έ", "ε"], ["ή", "η"], ["ί", "ι"], ["ό", "ο"], ["ύ", "υ"], ["ώ", "ω"],
  ["ϊ", "ι"], ["ϋ", "υ"], ["ΐ", "ι"], ["ΰ", "υ"], ["ς", "σ"],
  ["Ά", "α"], ["Έ", "ε"], ["Ή", "η"], ["Ί", "ι"], ["Ό", "ο"], ["Ύ", "υ"], ["Ώ", "ω"],
  ["Ϊ", "ι"], ["Ϋ", "υ"],
  // Κεφαλαία ελληνικά: για βάση με locale που δεν κάνει lower() σε μη-ASCII.
  ["Α", "α"], ["Β", "β"], ["Γ", "γ"], ["Δ", "δ"], ["Ε", "ε"], ["Ζ", "ζ"], ["Η", "η"],
  ["Θ", "θ"], ["Ι", "ι"], ["Κ", "κ"], ["Λ", "λ"], ["Μ", "μ"], ["Ν", "ν"], ["Ξ", "ξ"],
  ["Ο", "ο"], ["Π", "π"], ["Ρ", "ρ"], ["Σ", "σ"], ["Τ", "τ"], ["Υ", "υ"], ["Φ", "φ"],
  ["Χ", "χ"], ["Ψ", "ψ"], ["Ω", "ω"],
  // Λατινικά με τόνους (συνήθη σε ξένους πελάτες).
  ["à", "a"], ["á", "a"], ["â", "a"], ["ä", "a"], ["ã", "a"], ["å", "a"],
  ["è", "e"], ["é", "e"], ["ê", "e"], ["ë", "e"],
  ["ì", "i"], ["í", "i"], ["î", "i"], ["ï", "i"],
  ["ò", "o"], ["ó", "o"], ["ô", "o"], ["ö", "o"], ["õ", "o"],
  ["ù", "u"], ["ú", "u"], ["û", "u"], ["ü", "u"],
  ["ç", "c"], ["ñ", "n"], ["ý", "y"],
  ["À", "a"], ["Á", "a"], ["Â", "a"], ["Ä", "a"], ["È", "e"], ["É", "e"], ["Ê", "e"],
  ["Ë", "e"], ["Ì", "i"], ["Í", "i"], ["Î", "i"], ["Ï", "i"], ["Ò", "o"], ["Ó", "o"],
  ["Ô", "o"], ["Ö", "o"], ["Ù", "u"], ["Ú", "u"], ["Û", "u"], ["Ü", "u"], ["Ç", "c"],
  ["Ñ", "n"],
];

/** Για το translate() της PostgreSQL — ίδιο μήκος, χαρακτήρας-χαρακτήρας. */
export const FOLD_FROM = FOLD_PAIRS.map(([a]) => a).join("");
export const FOLD_TO = FOLD_PAIRS.map(([, b]) => b).join("");

const FOLD_MAP = new Map(FOLD_PAIRS);

/** Πεζά, χωρίς τόνους/διαλυτικά, ς → σ. Τα κενά μένουν. */
export function foldText(input: string): string {
  let out = "";
  for (const ch of input.toLowerCase()) out += FOLD_MAP.get(ch) ?? ch;
  return out;
}

/**
 * Ελληνικά γράμματα που μοιάζουν με λατινικά (όπως σε πινακίδες ή αριθμούς
 * εγγράφων: «ΑΚ 123456» = «AK123456»). Μόνο για ταυτότητα/δίπλωμα.
 */
const LOOKALIKE: Record<string, string> = {
  α: "a", β: "b", ε: "e", ζ: "z", η: "h", ι: "i", κ: "k", μ: "m",
  ν: "n", ο: "o", ρ: "p", τ: "t", υ: "y", χ: "x",
};

/** Αριθμός εγγράφου: χωρίς κενά/σύμβολα, ελληνικά-λατινικά ίδια. */
export function docKey(input: string): string {
  return Array.from(foldText(input).replace(/[^\p{L}\p{N}]+/gu, ""))
    .map((ch) => LOOKALIKE[ch] ?? ch)
    .join("");
}

/**
 * Τα ψηφία ενός τηλεφώνου χωρίς κενά/σύμβολα και χωρίς το +30/0030,
 * ώστε «+30 694 123 4567» = «6941234567».
 */
export function phoneDigits(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("30") && d.length === 12) d = d.slice(2);
  return d;
}

/* ─────────────────────────────────────────────
   Αναζήτηση ανά πεδίο του κύριου οδηγού
   ───────────────────────────────────────────── */

export const CUSTOMER_SEARCH_FIELDS = [
  "name",
  "phone",
  "email",
  "idNumber",
  "licenseNumber",
  "address",
] as const;
export type CustomerSearchField = (typeof CUSTOMER_SEARCH_FIELDS)[number];

export const isCustomerSearchField = (v: string): v is CustomerSearchField =>
  (CUSTOMER_SEARCH_FIELDS as readonly string[]).includes(v);

/** Ελάχιστο μήκος: 2 χαρακτήρες σε κείμενο, 3 ψηφία σε τηλέφωνο/έγγραφο. */
export const MIN_TEXT_CHARS = 2;
export const MIN_DIGITS = 3;

/** Τα στοιχεία πελάτη που χρειάζεται το ταίριασμα (μόνο στον server). */
export interface MatchableCustomer {
  firstName: string;
  lastName: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  idNumber: string | null;
  licenseNumber: string | null;
  address: string | null;
  city: string | null;
}

export type SearchQuery =
  | { kind: "words"; words: string[] }
  | { kind: "digits"; digits: string }
  | { kind: "doc"; key: string; digits: string };

/** Το ερώτημα ενός πεδίου, ή null όταν είναι πολύ μικρό για αναζήτηση. */
export function searchQueryFor(field: CustomerSearchField, raw: string): SearchQuery | null {
  const q = raw.trim().slice(0, 100);
  if (field === "phone") {
    const digits = phoneDigits(q);
    return digits.length >= MIN_DIGITS ? { kind: "digits", digits } : null;
  }
  if (field === "idNumber" || field === "licenseNumber") {
    const key = docKey(q);
    return key.length >= MIN_DIGITS ? { kind: "doc", key, digits: key.replace(/\D/g, "") } : null;
  }
  const words = foldText(q).split(/\s+/).filter(Boolean).slice(0, 4);
  return words.join("").length >= MIN_TEXT_CHARS ? { kind: "words", words } : null;
}

/** Ταιριάζει ο πελάτης στο ερώτημα του πεδίου; (Η ΤΕΛΙΚΗ απόφαση.) */
export function customerMatches(
  c: MatchableCustomer,
  field: CustomerSearchField,
  q: SearchQuery
): boolean {
  switch (q.kind) {
    case "digits": {
      const phones = [c.phone, c.phone2].filter((p): p is string => !!p).map(phoneDigits);
      return phones.some((p) => p.includes(q.digits));
    }
    case "doc": {
      const value = field === "idNumber" ? c.idNumber : c.licenseNumber;
      return !!value && docKey(value).includes(q.key);
    }
    case "words": {
      const haystack =
        field === "email"
          ? [c.email ?? ""]
          : field === "address"
            ? [`${c.address ?? ""} ${c.city ?? ""}`]
            : [c.firstName, c.lastName];
      const folded = haystack.map(foldText);
      // Κάθε λέξη σε κάποιο από τα πεδία («Γιάννης Παπ» βρίσκει).
      return q.words.every((w) => folded.some((h) => h.includes(w)));
    }
  }
}

/* ─────────────────────────────────────────────
   Διπλότυπα (νέος πελάτης με ίδιο τηλέφωνο/email)
   ───────────────────────────────────────────── */

/** Τα κλειδιά σύγκρισης: τα τελευταία 10 ψηφία (≥7) και το email σε πεζά. */
export function duplicateKeys(phone: string, email: string) {
  const digits = phoneDigits(phone);
  const key = digits.length > 10 ? digits.slice(-10) : digits;
  return {
    phone: key.length >= 7 ? key : "",
    email: email.trim().toLowerCase(),
  };
}

/** Είναι ο υπάρχων πελάτης πιθανός διπλότυπος του νέου; */
export function isDuplicateOf(
  existing: Pick<MatchableCustomer, "phone" | "phone2" | "email">,
  fresh: { phone: string; email: string }
): boolean {
  const keys = duplicateKeys(fresh.phone, fresh.email);
  const phones = [existing.phone, existing.phone2]
    .filter((p): p is string => !!p)
    .map(phoneDigits);
  if (keys.phone && phones.some((p) => p.endsWith(keys.phone))) return true;
  return !!keys.email && (existing.email ?? "").trim().toLowerCase() === keys.email;
}

/* ─────────────────────────────────────────────
   Κύριος οδηγός → πελάτης
   ───────────────────────────────────────────── */

/** Τα στοιχεία του κύριου οδηγού που έχουν θέση στο μοντέλο Customer. */
export interface DriverLike {
  fullName: string;
  country: string;
  licenseNumber: string;
  licenseExpiry: string;
  birthDate: string;
  idNumber: string;
  phone: string;
  email: string;
  address: string;
}

export interface CustomerFields {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  idNumber: string | null;
  licenseNumber: string | null;
  /** "YYYY-MM-DD" ή null */
  licenseExpiry: string | null;
  licenseCountry: string | null;
  /** "YYYY-MM-DD" ή null */
  dateOfBirth: string | null;
  address: string | null;
}

/** «Γιάννης Παπαδόπουλος» → όνομα + επώνυμο (το επώνυμο μπορεί να είναι κενό). */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** Νέος πελάτης από τον κύριο οδηγό — μόνο πεδία που υπάρχουν ήδη στο Customer. */
export function customerFromDriver(d: DriverLike): CustomerFields {
  return {
    ...splitFullName(d.fullName),
    phone: orNull(d.phone),
    email: orNull(d.email),
    idNumber: orNull(d.idNumber),
    licenseNumber: orNull(d.licenseNumber),
    licenseExpiry: orNull(d.licenseExpiry),
    licenseCountry: orNull(d.country),
    dateOfBirth: orNull(d.birthDate),
    address: orNull(d.address),
  };
}

/**
 * Υπάρχων πελάτης: συμπληρώνονται ΜΟΝΟ τα κενά του πεδία από τον κύριο
 * οδηγό. Υπάρχουσα τιμή δεν αντικαθίσταται ποτέ (ούτε το όνομα).
 */
export function missingCustomerFields(
  existing: Partial<Record<keyof CustomerFields, string | null>>,
  fromDriver: CustomerFields
): Partial<CustomerFields> {
  const out: Partial<CustomerFields> = {};
  const keys: (keyof CustomerFields)[] = [
    "phone",
    "email",
    "idNumber",
    "licenseNumber",
    "licenseExpiry",
    "dateOfBirth",
    "address",
  ];
  for (const k of keys) {
    const now = existing[k];
    const next = fromDriver[k];
    if (next && (now === null || now === undefined || String(now).trim() === "")) {
      (out as Record<string, string>)[k] = next;
    }
  }
  return out;
}
