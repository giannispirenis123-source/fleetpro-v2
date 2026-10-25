// tests/audit-route-guards.test.mjs
// Έλεγχος (audit) — ΚΑΜΙΑ αλλαγή συμπεριφοράς. Το middleware αφήνει ΟΛΑ τα
// /api/* να περάσουν (src/middleware.ts), άρα ΚΑΘΕ route πρέπει να
// προστατεύει μόνο του τον εαυτό του στον server. Αυτά τα tests κλειδώνουν
// τη σημερινή εικόνα: όποιο νέο route ξεχάσει φύλακα, σπάει εδώ.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const API = join(ROOT, "src/app/api");

function routes(dir = API) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return routes(p);
    return n === "route.ts" ? [p] : [];
  });
}

const rel = (p) => "/" + relative(API, p).replace(/\/route\.ts$/, "");
const HANDLER_RE = /export (?:const|async function) (GET|POST|PATCH|PUT|DELETE)\b/g;
const GUARD_RE = /export const (GET|POST|PATCH|PUT|DELETE) = (withAuth|withPermission|withPublicSite)\(/g;

/**
 * Routes ΧΩΡΙΣ φύλακα — σκόπιμα δημόσια ή με δικό τους έλεγχο session.
 * Κάθε προσθήκη εδώ θέλει αιτιολόγηση.
 */
const NO_WRAPPER = {
  "/auth/login": "σύνδεση (δημόσιο)",
  "/auth/logout": "αποσύνδεση (σβήνει μόνο το cookie)",
  "/auth/me": "getSessionFromRequest στο handler",
  "/users/me/locale": "getSessionFromRequest στο handler — μόνο ο ίδιος χρήστης",
  "/public/booking": "δημόσια κράτηση: εταιρία ΜΟΝΟ από το slug, rate limits",
  "/public/quote": "δημόσια τιμή: εταιρία ΜΟΝΟ από το slug",
  "/stripe/connect/webhook": "υπογραφή Stripe (STRIPE_CONNECT_WEBHOOK_SECRET)",
  "/auth/signup": "αυτόματη εγγραφή (δημόσιο): SELF_SIGNUP_ENABLED, rate limits, ουδέτερη απάντηση",
  "/auth/verify-email": "επαλήθευση email (δημόσιο): SELF_SIGNUP_ENABLED, token μίας χρήσης, rate limit",
  "/auth/resend-verification": "νέος σύνδεσμος (δημόσιο): SELF_SIGNUP_ENABLED, rate limits, ουδέτερη απάντηση",
  "/billing/webhook": "υπογραφή Stripe (STRIPE_BILLING_WEBHOOK_SECRET) — ξεχωριστό από το Connect",
  "/public/founding-spots": "δημόσιο: ΜΟΝΟ ο αριθμός θέσεων ιδρυτών, SELF_SIGNUP_ENABLED, rate limit ανά IP",
};

const ALL = routes();

test("κάθε API route: όλα τα handlers έχουν φύλακα στον server ή είναι στη λίστα δημόσιων", () => {
  const unguarded = [];
  for (const f of ALL) {
    const src = readFileSync(f, "utf8");
    const handlers = [...src.matchAll(HANDLER_RE)].map((m) => m[1]);
    const guarded = new Set([...src.matchAll(GUARD_RE)].map((m) => m[1]));
    const missing = handlers.filter((h) => !guarded.has(h));
    if (missing.length && !(rel(f) in NO_WRAPPER)) unguarded.push(`${rel(f)} [${missing.join(",")}]`);
  }
  assert.deepEqual(unguarded, [], "routes χωρίς φύλακα");
  assert.ok(ALL.length >= 90, `βρέθηκαν ${ALL.length} routes`);
  // Η λίστα δεν κρατά routes που δεν υπάρχουν πια.
  const stale = Object.keys(NO_WRAPPER).filter((r) => !ALL.some((f) => rel(f) === r));
  assert.deepEqual(stale, [], "NO_WRAPPER με routes που σβήστηκαν");
});

test("routes χωρίς wrapper που θέλουν σύνδεση ελέγχουν session ΜΕΣΑ στο handler", () => {
  for (const r of ["/auth/me", "/users/me/locale"]) {
    const src = readFileSync(join(API, r.slice(1), "route.ts"), "utf8");
    assert.match(src, /getSessionFromRequest\(req\)/, r);
    assert.match(src, /if \(!session\) return unauthorized\(\)/, r);
  }
  // Η γλώσσα αλλάζει ΜΟΝΟ για τον χρήστη του session (ποτέ id από το body).
  assert.match(readFileSync(join(API, "users/me/locale/route.ts"), "utf8"), /where: \{ id: session\.userId \}/);
});

test("Super Admin routes: μόνο SUPER_ADMIN", () => {
  for (const r of ["tenants/route.ts", "tenants/[id]/route.ts", "super-admin/platform-discounts/route.ts", "super-admin/platform-discounts/[id]/route.ts", "plans/route.ts", "super-admin/signup-cleanup/route.ts", "super-admin/founding/route.ts", "super-admin/feedback/route.ts", "tenants/[id]/deletion/route.ts"]) {
    const src = readFileSync(join(API, r), "utf8");
    assert.match(src, /\["SUPER_ADMIN"\]/, r);
  }
});

test("routes με [id]: σε όλα υπάρχει περιορισμός στην εταιρία της συνεδρίας (tenantId / scope / φύλακας με companyId)", () => {
  const scoped = /tenantId|contractScope\(|bookingScope\(|withPublicSite\(|companyId|loadPhotoVehicle\(|mutateContractPhotos\(|loadContractPaymentContext\(|\["SUPER_ADMIN"\]/;
  const unscoped = ALL.filter((f) => f.includes("[")).filter((f) => !scoped.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(unscoped, [], "routes με [id] χωρίς ορατό περιορισμό εταιρίας");
});

test("μυστικά: κανένα NEXT_PUBLIC_ στον κώδικα (το cloud name του Cloudinary διαβάζεται μόνο στον server)", () => {
  const files = [];
  const walk = (d) =>
    readdirSync(d).forEach((n) => {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    });
  walk(join(ROOT, "src"));
  const used = new Set();
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) used.add(m[1]);
  assert.deepEqual([...used], [], "process.env.NEXT_PUBLIC_* καταλήγει στον browser");
});

test("raw SQL: μόνο tagged templates (καμία *Unsafe παραλλαγή)", () => {
  const files = [];
  const walk = (d) =>
    readdirSync(d).forEach((n) => {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    });
  walk(join(ROOT, "src"));
  const unsafe = files.filter((f) => /\$(queryRaw|executeRaw)Unsafe/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  assert.deepEqual(unsafe, []);
});

/* ── Ευρήματα του audit (19/10/2026) που διορθώθηκαν στο PR #31 ──
   Η λογική ελέγχεται αναλυτικά στο tests/audit-fixes.test.mjs· εδώ μένει ο
   φύλακας σε επίπεδο routes, ώστε να μην ξαναγυρίσουν. */

const read = (r) => readFileSync(join(ROOT, r), "utf8");

test("AUDIT ✓: το ανοιχτό /api/discounts/validate δεν υπάρχει πια", () => {
  assert.equal(ALL.some((f) => rel(f) === "/discounts/validate"), false);
});

test("AUDIT ✓: security headers (nosniff, HSTS, frame-ancestors) στο next.config.js", () => {
  const cfg = read("next.config.js");
  for (const h of ["X-Content-Type-Options", "Strict-Transport-Security", "X-Frame-Options", "frame-ancestors"]) assert.match(cfg, new RegExp(h), h);
});

test("AUDIT ✓: «Εμφάνιση» αριθμού κάρτας με όριο και καταγραφή στο ιστορικό", () => {
  const src = read("src/app/api/contracts/[id]/card-number/route.ts");
  assert.match(src, /hitLimit\(/);
  assert.match(src, /activityLog\.create\(/);
});

test("AUDIT ✓: εταιρία SUSPENDED/CANCELLED μπλοκάρεται σε κάθε αίτημα (withAuth → loadViewer)", () => {
  assert.match(read("src/lib/api.ts"), /await loadViewer\(/);
  assert.match(read("src/lib/viewerCore.ts"), /"SUSPENDED", "CANCELLED"/);
});

test("AUDIT ✓: /api/users/me/locale ελέγχει τον χρήστη πριν ανανεώσει το token", () => {
  const src = read("src/app/api/users/me/locale/route.ts");
  assert.ok(src.indexOf("loadViewer(") > -1 && src.indexOf("loadViewer(") < src.indexOf("signToken("), "loadViewer πριν το signToken");
});

test("AUDIT ✓: όριο προσπαθειών στο /api/auth/login", () => {
  const src = read("src/app/api/auth/login/route.ts");
  // Τα λάθη ανά email: κλείδωμα μετά από 10 λάθος κωδικούς (loginLock.ts).
  assert.match(src, /isLoginLocked\(/);
  assert.match(src, /recordLoginFailure\(/);
  assert.match(src, /LIMITS\.loginPerIp/);
});

test("AUDIT ✓: ληγμένη αναμονή πληρωμής αποδεσμεύει μόνο κράτηση PENDING", () => {
  assert.match(read("src/lib/public/payments.ts"), /NOT: \{ status: "PENDING"/);
});

test("AUDIT ✓: κρατήσεις dashboard (POST/PATCH, walk-in) στο ίδιο advisory lock με το site", () => {
  assert.match(read("src/lib/bookingCreate.ts"), /pg_advisory_xact_lock\(hashtext\(\$\{lockKeyFor\(/);
  assert.match(read("src/app/api/bookings/[id]/route.ts"), /pg_advisory_xact_lock\(hashtext\(\$\{lockKeyFor\(/);
});

test("AUDIT ✓: nextBookingNumber με αριθμητικό max", () => {
  assert.match(read("src/lib/bookingCreate.ts"), /MAX\(CAST\(substring\("bookingNumber"/);
});

// Ανοιχτά — θέλουν SQL ή απόφαση (βλ. docs/HANDOFF.md → «Audit 10/2026»).
test("AUDIT ✓: UNIQUE (tenantId, bookingNumber) — SQL 30, με επανάληψη σε σύγκρουση", () => {
  assert.match(read("prisma/sql/30-booking-number-unique.sql"), /CREATE UNIQUE INDEX IF NOT EXISTS "bookings_tenantId_bookingNumber_key"/);
  assert.match(read("prisma/schema.prisma"), /@@unique\(\[tenantId, bookingNumber\]\)/);
  assert.match(read("src/lib/bookingNumberRetry.ts"), /export async function withBookingNumberRetry/);
});
test.todo("AUDIT: η ποσότητα των πρόσθετων κρατιέται στην επανατιμολόγηση (requestFromBooking qty) — αλλάζει τιμές, θέλει απόφαση");

test("DELETE /api/users/[id] (οριστική διαγραφή): φύλακας στον server + μόνο Διαχειριστής ίδιας εταιρίας", () => {
  const src = readFileSync(join(API, "users/[id]/route.ts"), "utf8");
  assert.match(src, /export const DELETE = withAuth\(/);
  assert.equal("/users/[id]" in NO_WRAPPER, false);
  // Ο ρόλος/η εταιρία από τον viewer (βάση), ΠΟΤΕ από body/URL — εκτός από το id του στόχου.
  assert.match(src, /hardDeleteCompanyUser\(\{ id: viewer\.userId, role: viewer\.role, tenantId: viewer\.tenantId \}, params!\.id\)/);
  const lib = readFileSync(join(ROOT, "src/lib/userDelete.ts"), "utf8");
  assert.match(lib, /where: \{ id: targetId, tenantId \}/, "στόχος μόνο της ίδιας εταιρίας");
  assert.match(lib, /if \(!isCompanyAdmin\(actor\) \|\| !tenantId\) return \{ ok: false, status: 403/);
});

test("Συνδρομές (SQL 36): /api/billing/* μόνο Διαχειριστής, εταιρία από το session", () => {
  for (const r of ["billing/route.ts", "billing/checkout/route.ts", "billing/portal/route.ts", "billing/plan/route.ts", "billing/sync/route.ts"]) {
    const src = readFileSync(join(API, r), "utf8");
    assert.match(src, /= withAuth\(/, r);
    assert.match(src, /\["COMPANY_ADMIN"\]\);\s*$/, r);
    assert.match(src, /session\.tenantId!/, r);
    assert.doesNotMatch(src, /tenantId:\s*body|body\.tenantId/, r);
  }
  // Κάθε φρουρούμενο route περνά από τον έλεγχο «μόνο ανάγνωση».
  assert.match(read("src/lib/api.ts"), /viewer\.readOnly && !readOnlyAllows\(req\.method, req\.nextUrl\.pathname\)/);
});

