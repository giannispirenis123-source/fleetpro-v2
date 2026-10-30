// src/lib/storefront/domain.ts
// Domain ανά εταιρία — καθαρή λογική, χωρίς imports (τρέχει και στο middleware).
//
// Πώς δουλεύει: ένα αίτημα σε host που ΔΕΝ είναι της πλατφόρμας (localhost,
// *.vercel.app, το base domain του PLATFORM_URL και το www. του) θεωρείται
// «domain εταιρίας». Το middleware
// μεταφράζει τη διαδρομή του (/el/search) στην εσωτερική /s/_domain/el/search
// και περνά το host στο SITE_HOST_HEADER (αφού το καθαρίσει — κάθε εισερχόμενο
// header με αυτό το όνομα σβήνεται). Η εταιρία βρίσκεται ΜΟΝΟ από το
// resolveStorefrontByHost (resolve.ts), ΜΟΝΟ με customDomainStatus = VERIFIED.
// Άγνωστο ή μη επαληθευμένο domain → το ίδιο 404, χωρίς στοιχεία.

/** Header που βάζει ΜΟΝΟ το middleware: το (καθαρό) host του domain εταιρίας. */
export const SITE_HOST_HEADER = "x-fleetpro-site-host";

/**
 * Η τιμή του [slug] στις εσωτερικές διαδρομές του domain (/s/_domain/…). Δεν
 * είναι έγκυρο slug (canonicalSlug → null), άρα ποτέ δεν συγκρούεται με
 * εταιρία, και στο /s/_domain της πλατφόρμας δίνει 404 (δεν υπάρχει header).
 */
export const DOMAIN_SLUG = "_domain";

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Host όπως ήρθε (header ή πληκτρολόγηση) → έγκυρο hostname σε πεζά, χωρίς
 * θύρα και τελεία στο τέλος, ή null. Δέχεται ΜΟΝΟ a-z, 0-9, παύλα και τελεία
 * (κανένα κενό, CR/LF, «/», «@», «_») — ό,τι περάσει είναι ασφαλές για header
 * και URL. Τουλάχιστον δύο τμήματα, όχι IP.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  let h = raw.trim().toLowerCase();
  const port = h.match(/^([^:]+):(\d{1,5})$/);
  if (port) h = port[1];
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (!h || h.length > 253 || IPV4_RE.test(h)) return null;
  const labels = h.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return null;
  // Το τελευταίο τμήμα (TLD) δεν είναι ποτέ μόνο αριθμοί.
  if (/^\d+$/.test(labels[labels.length - 1])) return null;
  return h;
}

/** Το host του αιτήματος (Vercel: x-forwarded-host, αλλιώς Host), καθαρό ή null. */
export function requestHost(get: (name: string) => string | null): string | null {
  const raw = (get("x-forwarded-host") ?? get("host"))?.split(",")[0];
  return normalizeHost(raw);
}

/** Host από URL ή σκέτο host (π.χ. env), καθαρό ή null. */
function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  try {
    return normalizeHost(new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).host);
  } catch {
    return null;
  }
}

export interface PlatformEnv {
  PLATFORM_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
}

/**
 * Οι μεταβλητές με ρητή ανάγνωση (στο Edge/middleware το process.env δεν
 * διαβάζεται ως ολόκληρο αντικείμενο). Τα VERCEL_* τα βάζει μόνο του το Vercel.
 * Το PLATFORM_URL (π.χ. https://platform.example) είναι η ΜΙΑ ρύθμιση για το domain
 * της πλατφόρμας: από αυτό βγαίνει το base domain (platformBaseDomain).
 */
export function readPlatformEnv(): PlatformEnv {
  return {
    PLATFORM_URL: process.env.PLATFORM_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
  };
}

/**
 * Το base domain της πλατφόρμας: το host του PLATFORM_URL χωρίς «www.»
 * (https://www.platform.example → platform.example). null = δεν ορίστηκε.
 */
export function platformBaseDomain(env: PlatformEnv): string | null {
  const host = hostOf(env.PLATFORM_URL);
  if (!host) return null;
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  return bare.includes(".") ? bare : host;
}

/**
 * Τα hosts της ίδιας της πλατφόρμας: το base domain ΚΑΙ το www. του (ΟΧΙ τα
 * άλλα subdomains — company.platform.example μένει domain εταιρίας όπως πριν), συν
 * όσα δίνει μόνο του το Vercel (production/deployment/branch URL).
 */
export function platformHostsFromEnv(env: PlatformEnv): string[] {
  const base = platformBaseDomain(env);
  const hosts = [
    base,
    base ? `www.${base}` : null,
    ...[env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL].map(hostOf),
  ].filter((h): h is string => !!h);
  return [...new Set(hosts)];
}

/**
 * Η διεύθυνση της πλατφόρμας για το κουμπί «Είσοδος» στο domain εταιρίας:
 * PLATFORM_URL ή το production domain του Vercel. null = άγνωστη (τοπικά).
 */
export function platformOrigin(env: PlatformEnv): string | null {
  if (env.PLATFORM_URL) {
    try {
      const u = new URL(env.PLATFORM_URL.trim());
      if ((u.protocol === "https:" || u.protocol === "http:") && u.host) return `${u.protocol}//${u.host}`;
    } catch {
      /* άκυρο → συνέχεια */
    }
  }
  const prod = hostOf(env.VERCEL_PROJECT_PRODUCTION_URL);
  return prod ? `https://${prod}` : null;
}

/** Domains που ΔΕΝ είναι ποτέ domain εταιρίας (και δεν δηλώνονται στο dashboard). */
const PLATFORM_SUFFIXES = [".vercel.app", ".vercel.sh", ".vercel-dns.com"];

/**
 * Είναι host της πλατφόρμας (dashboard, login, /s/…, /c/…) — δηλαδή ΟΧΙ domain
 * εταιρίας; Μη έγκυρο host, IP ή localhost → πλατφόρμα (η σημερινή
 * συμπεριφορά μένει ίδια για ό,τι δεν είναι καθαρό όνομα).
 */
export function isPlatformHost(host: string | null, platformHosts: readonly string[] = []): boolean {
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (PLATFORM_SUFFIXES.some((s) => host.endsWith(s) || host === s.slice(1))) return true;
  return platformHosts.includes(host);
}

export type DomainCheck =
  | { ok: true; domain: string }
  | { ok: false; reason: "format" | "platform" | "taken"; message: string };

/**
 * Ό,τι έγραψε ο Admin («https://www.Helios-Rent.gr/el») → host, με ελέγχους
 * μορφής και ότι δεν είναι domain της πλατφόρμας. Η μοναδικότητα ελέγχεται
 * με τη βάση (domainOwner) και επιβάλλεται από τα UNIQUE indexes (SQL 33).
 */
export function validateCustomDomain(input: unknown, platformHosts: readonly string[] = []): DomainCheck {
  if (typeof input !== "string") return { ok: false, reason: "format", message: "Μη έγκυρο domain." };
  let v = input.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "");
  v = v.replace(/[/?#].*$/, "");
  const host = v.includes(":") ? null : normalizeHost(v);
  if (!host) {
    return {
      ok: false,
      reason: "format",
      message: "Γράψτε μόνο το domain, π.χ. www.helios-rent.gr (λατινικά, χωρίς κενά, θύρα ή διαδρομή).",
    };
  }
  if (isPlatformHost(host, platformHosts)) {
    return { ok: false, reason: "platform", message: "Αυτό είναι domain της πλατφόρμας και δεν μπορεί να χρησιμοποιηθεί." };
  }
  return { ok: true, domain: host };
}

/** Μοναδικότητα: `ownerId` = η εταιρία που ΗΔΗ έχει το domain (null αν καμία). */
export function checkDomainAvailability(
  input: unknown,
  ownerId: string | null,
  companyId: string,
  platformHosts: readonly string[] = []
): DomainCheck {
  const check = validateCustomDomain(input, platformHosts);
  if (!check.ok) return check;
  if (ownerId !== null && ownerId !== companyId) {
    return { ok: false, reason: "taken", message: "Αυτό το domain χρησιμοποιείται ήδη από άλλη εταιρία." };
  }
  return check;
}

/** Τι κάνει το middleware με ένα αίτημα σε domain εταιρίας. */
export type DomainRoute =
  | { kind: "rewrite"; path: string }
  | { kind: "redirect"; path: string }
  | { kind: "login" }
  | { kind: "pass" }
  | { kind: "notFound" };

/**
 * Διαδρομή στο domain εταιρίας → εσωτερική διαδρομή του site. ΜΟΝΟ το site:
 *   /                  → /s/_domain           (redirect στη γλώσσα της εταιρίας)
 *   /<lang>/…          → /s/_domain/<lang>/…
 *   /sitemap.xml, /robots.txt, /v/<id> (παλιά μορφή) → αντίστοιχα
 *   /s/<οτιδήποτε>/…   → 308 στο καθαρό /… (ποτέ άλλη εταιρία: το domain κρίνει)
 *   /login, /dashboard → στο login της πλατφόρμας (κουμπί «Είσοδος»)
 *   /api/public/…      → όπως είναι (αναζήτηση/κράτηση του site)
 *   /_next/…          → όπως είναι (αρχεία της εφαρμογής)
 *   /c/, /pay/, /api/…, /super-admin, /print … → 404
 */
export function routeCustomDomain(pathname: string): DomainRoute {
  if (pathname === "/" || pathname === "") return { kind: "rewrite", path: `/s/${DOMAIN_SLUG}` };
  if (pathname.startsWith("/api/public/")) return { kind: "pass" };
  if (/^\/(login|dashboard)(\/|$)/.test(pathname)) return { kind: "login" };
  const first = pathname.split("/")[1] ?? "";
  if (first === "s") {
    const rest = pathname.split("/").slice(3).join("/");
    return { kind: "redirect", path: `/${rest}` };
  }
  if (first === "_next") return { kind: "pass" };
  // Εγγραφή/επαλήθευση/νομικά της ΠΛΑΤΦΟΡΜΑΣ: ποτέ στο domain εταιρίας.
  if (/^(api|c|pay|print|super-admin|signup|verify-email|legal)$/.test(first)) return { kind: "notFound" };
  return { kind: "rewrite", path: `/s/${DOMAIN_SLUG}${pathname}` };
}

/**
 * Headers απάντησης για μια εσωτερική διαδρομή του site (/s/<slug|_domain>/…):
 * ΙΔΙΟΙ κανόνες για /s/<slug> και για το domain. Αναζήτηση/κράτηση: noindex·
 * επιβεβαίωση κράτησης: noindex + no-store + no-referrer.
 */
export function siteResponseHeaders(internalPath: string): [string, string][] {
  if (/^\/s\/[^/]+\/[a-z]{2}\/(search|book)\/?$/.test(internalPath)) {
    return [["X-Robots-Tag", "noindex, nofollow"]];
  }
  if (/^\/s\/[^/]+\/[a-z]{2}\/booking\/[^/]+\/?$/.test(internalPath)) {
    return [
      ["X-Robots-Tag", "noindex, nofollow, noarchive"],
      ["Cache-Control", "no-store, max-age=0"],
      ["Referrer-Policy", "no-referrer"],
    ];
  }
  return [];
}

/* ─────────────────────────────────────────────
   Επαλήθευση DNS («Έλεγχος domain») — η απόφαση, χωρίς δίκτυο
   ───────────────────────────────────────────── */

/** Οι εγγραφές που δείχνει το Vercel (Settings → Domains): A για το σκέτο domain, CNAME για το www. */
export const VERCEL_A_RECORD = "76.76.21.21";
export const VERCEL_CNAME_RECORD = "cname.vercel-dns.com";

/**
 * Δίκτυα IP του Vercel για A εγγραφές: το κλασικό 76.76.21.21 και τα νεότερα
 * που προτείνει το Vercel σε νέα projects (216.198.79.x, 64.29.17.x).
 */
const VERCEL_IPV4_PREFIXES = ["76.76.21.", "216.198.79.", "64.29.17."];
/** CNAME του Vercel: cname.vercel-dns.com ή <id>.vercel-dns-0NN.com (ανά project). */
const VERCEL_CNAME_RE = /(^|\.)vercel-dns(-\d{1,4})?\.com$/;

export interface DnsAnswer {
  cnames: string[];
  ips: string[];
}

export type DnsVerdict =
  | { ok: true; via: "CNAME" | "A"; value: string }
  | { ok: false; reason: "no_records" | "elsewhere"; found: string[] };

/** Δείχνει το domain στο Vercel (άρα στην εφαρμογή, αφού προστέθηκε στο project); */
export function dnsPointsToApp(answer: DnsAnswer): DnsVerdict {
  const cnames = answer.cnames.map((c) => c.toLowerCase().replace(/\.$/, ""));
  const cname = cnames.find((c) => VERCEL_CNAME_RE.test(c));
  if (cname) return { ok: true, via: "CNAME", value: cname };
  const ip = answer.ips.find((a) => VERCEL_IPV4_PREFIXES.some((p) => a.startsWith(p)));
  if (ip) return { ok: true, via: "A", value: ip };
  const found = [...cnames, ...answer.ips].slice(0, 6);
  return { ok: false, reason: found.length ? "elsewhere" : "no_records", found };
}

/** Σκέτο domain (helios.gr) → εγγραφή A· υποτομέας (www.helios.gr) → CNAME. */
export function dnsInstructions(domain: string): { type: "A" | "CNAME"; name: string; value: string } {
  const labels = domain.split(".");
  // Ελληνικά/ευρωπαϊκά δεύτερου επιπέδου (helios.com.gr) μετρούν ως σκέτο domain.
  const apexLen = /^(com|org|net|gov|edu|co|ac)$/.test(labels[labels.length - 2] ?? "") && labels.length >= 3 ? 3 : 2;
  if (labels.length <= apexLen) return { type: "A", name: "@", value: VERCEL_A_RECORD };
  return { type: "CNAME", name: labels.slice(0, labels.length - apexLen).join("."), value: VERCEL_CNAME_RECORD };
}
