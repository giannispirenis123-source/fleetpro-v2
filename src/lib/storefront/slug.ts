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
      message:
        "Μόνο μικρά λατινικά γράμματα (a-z), αριθμοί και παύλα (-), χωρίς κενά και ελληνικά — η παύλα όχι στην αρχή/τέλος ή διπλή.",
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

export type SitePath =
  | ""
  | "search"
  | "book"
  | "terms"
  | "privacy"
  | "cookies"
  | { vehicleId: string }
  | { placeSlug: string };

/**
 * Η διεύθυνση μιας δημόσιας σελίδας: ΠΑΝΤΑ με τη γλώσσα (/s/<slug>/<lang>),
 * ώστε αρχική, αναζήτηση και κράτηση να έχουν την ίδια μορφή
 * (/s/<slug>/<lang>/search, …/book, …/v/<id>). Το σκέτο /s/<slug> κάνει
 * redirect στην προεπιλεγμένη γλώσσα.
 * `page`: "" (αρχική), "search", "book", νομικά ("terms", "privacy",
 * "cookies"), { vehicleId } ή { placeSlug }.
 */
export function storefrontPath(
  slug: string,
  lang: string,
  page: SitePath = "",
  query = ""
): string {
  const tail =
    typeof page === "object"
      ? "placeSlug" in page
        ? `/places/${encodeURIComponent(page.placeSlug)}`
        : `/v/${encodeURIComponent(page.vehicleId)}`
      : page
        ? `/${page}`
        : "";
  return `/s/${slug}/${lang}${tail}${query ? `?${query}` : ""}`;
}

/**
 * Slug από το URL όπως μπορεί να το γράψει ένας άνθρωπος (κεφαλαία από το
 * πληκτρολόγιο του κινητού, κενά, τόνοι, %20) → η κανονική μορφή, ή null αν
 * δεν γίνεται έγκυρο slug. Π.χ. « Fleet-Pro-Chaniá » → «fleet-pro-chania».
 */
export function canonicalSlug(raw: string): string | null {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* μένει όπως ήρθε */
  }
  // Στο URL ανεχόμαστε και τόνους (é → e)· η φόρμα τους απορρίπτει.
  s = s.normalize("NFD").replace(/\p{M}/gu, "");
  const check = validateSlug(s);
  return check.ok ? check.slug : null;
}

/**
 * Για το middleware (χωρίς βάση): /s/<slug>/<lang>/… με slug ή γλώσσα σε μη
 * κανονική μορφή → η κανονική διαδρομή (για redirect). null = είναι ήδη
 * κανονική ή δεν σώζεται (θα δώσει 404 η σελίδα).
 */
export function canonicalSitePath(pathname: string): string | null {
  const parts = pathname.split("/");
  if (parts[1] !== "s" || !parts[2]) return null;
  const slug = canonicalSlug(parts[2]);
  if (!slug) return null;
  const next = [...parts];
  next[2] = slug;
  if (next[3] && /^[A-Za-z]{2}$/.test(next[3])) next[3] = next[3].toLowerCase();
  const out = next.join("/");
  return out === pathname ? null : out;
}

/** Συνήθη λάθη γλώσσας στο URL → ο σωστός κωδικός (π.χ. /gr → /el). */
export const LANGUAGE_ALIASES: Readonly<Record<string, string>> = { gr: "el", ell: "el", eng: "en", uk: "en" };

/**
 * Η γλώσσα του URL: υποστηριζόμενη → η ίδια· αλλιώς σε ποια να γίνει
 * redirect (γνωστό λάθος όπως /gr → el, αλλιώς η προεπιλεγμένη). Μη έγκυρη
 * γλώσσα ΔΕΝ δίνει 404 σε ανοιχτή σελίδα.
 */
export function chooseLanguage(
  langParam: string | undefined,
  supported: string[],
  defaultLanguage: string
): { ok: true; lang: string } | { ok: false; redirectTo: string } {
  if (langParam && supported.includes(langParam)) return { ok: true, lang: langParam };
  const alias = langParam ? LANGUAGE_ALIASES[langParam.toLowerCase()] : undefined;
  return { ok: false, redirectTo: alias && supported.includes(alias) ? alias : defaultLanguage };
}
