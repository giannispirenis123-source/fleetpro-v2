// src/lib/storefront/slug.ts
// Το slug της δημόσιας σελίδας (/s/<slug>) — καθαρή λογική, χωρίς imports.
//
// Κανόνες: a-z, 0-9 και παύλα · 3–40 χαρακτήρες · όχι παύλα στην αρχή/τέλος
// ή δύο συνεχόμενες · όχι δεσμευμένη λέξη. Η μοναδικότητα επιβάλλεται από
// το UNIQUE index "tenants_storefrontSlug_key"· το API ελέγχει και πριν.

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Δεσμευμένα: διαδρομές της εφαρμογής, κωδικοί γλωσσών και λέξεις που θα
 * μπέρδευαν τον επισκέπτη ή θα συγκρούονταν με μελλοντικές διαδρομές
 * (π.χ. αν το site μεταφερθεί στη ρίζα ή σε subdomain).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "login", "logout", "signup", "register", "dashboard", "api", "c", "s", "v",
  "admin", "super-admin", "superadmin", "print", "public", "static", "assets",
  "_next", "app", "www", "mail", "email", "help", "support", "about", "terms",
  "privacy", "blog", "docs", "status", "pricing", "fleetpro", "fleet-pro",
  "settings", "account", "billing", "booking", "bookings", "checkout", "pay",
  "payment", "payments", "contracts", "invoices", "new", "edit", "null",
  "undefined", "test", "demo", "el", "en", "fr", "de", "it", "es", "pl",
]);

/** Ό,τι πληκτρολόγησε ο χρήστης → μορφή slug (πεζά, χωρίς κενά άκρων). */
export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}

export type SlugCheck =
  | { ok: true; slug: string }
  | { ok: false; reason: "format" | "length" | "reserved" | "taken"; message: string };

/** Μορφή + δεσμευμένα (χωρίς βάση). */
export function validateSlug(input: string): SlugCheck {
  const slug = normalizeSlug(input);
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return {
      ok: false,
      reason: "length",
      message: `Το slug πρέπει να έχει ${SLUG_MIN} έως ${SLUG_MAX} χαρακτήρες.`,
    };
  }
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      reason: "format",
      message: "Μόνο λατινικά πεζά (a-z), αριθμοί και παύλα — όχι στην αρχή/τέλος ή διπλή.",
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: "reserved", message: "Αυτό το slug είναι δεσμευμένο. Διαλέξτε άλλο." };
  }
  return { ok: true, slug };
}

/**
 * Μορφή + μοναδικότητα. `ownerId` = η εταιρία που ΗΔΗ έχει αυτό το slug
 * (null αν κανείς). Η ίδια η εταιρία μπορεί να κρατήσει το δικό της.
 */
export function checkSlugAvailability(
  input: string,
  ownerId: string | null,
  companyId: string
): SlugCheck {
  const check = validateSlug(input);
  if (!check.ok) return check;
  if (ownerId !== null && ownerId !== companyId) {
    return { ok: false, reason: "taken", message: "Το slug χρησιμοποιείται ήδη από άλλη εταιρία." };
  }
  return check;
}

/**
 * Η διεύθυνση μιας δημόσιας σελίδας: ΠΑΝΤΑ με τη γλώσσα (/s/<slug>/<lang>),
 * ώστε αρχική, αναζήτηση και κράτηση να έχουν την ίδια μορφή
 * (/s/<slug>/<lang>/search, …/book, …/v/<id>). Το σκέτο /s/<slug> κάνει
 * redirect στην προεπιλεγμένη γλώσσα.
 * `page`: "" (αρχική), "search", "book", ή { vehicleId }.
 */
export function storefrontPath(
  slug: string,
  lang: string,
  page: "" | "search" | "book" | { vehicleId: string } = "",
  query = ""
): string {
  const tail =
    typeof page === "object" ? `/v/${encodeURIComponent(page.vehicleId)}` : page ? `/${page}` : "";
  return `/s/${slug}/${lang}${tail}${query ? `?${query}` : ""}`;
}
