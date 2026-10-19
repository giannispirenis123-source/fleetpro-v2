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
  // ΓΝΩΣΤΟ ΕΥΡΗΜΑ του audit: χωρίς σύνδεση, tenantId από το body, χωρίς όριο.
  // Επιτρέπει μάντεμα κωδικών έκπτωσης οποιασδήποτε εταιρίας. Να διορθωθεί.
  "/discounts/validate": "AUDIT: ΑΝΟΙΧΤΟ — βλ. test.todo παρακάτω",
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
  for (const r of ["tenants/route.ts", "tenants/[id]/route.ts", "super-admin/platform-discounts/route.ts", "super-admin/platform-discounts/[id]/route.ts", "plans/route.ts"]) {
    const src = readFileSync(join(API, r), "utf8");
    assert.match(src, /\["SUPER_ADMIN"\]/, r);
  }
});

test("routes με [id]: σε όλα υπάρχει περιορισμός στην εταιρία της συνεδρίας (tenantId / scope / φύλακας με companyId)", () => {
  const scoped = /tenantId|contractScope\(|bookingScope\(|withPublicSite\(|companyId|loadPhotoVehicle\(|mutateContractPhotos\(|\["SUPER_ADMIN"\]/;
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

test.todo("AUDIT: /api/discounts/validate — σύνδεση ή εταιρία από το slug + rate limit (σήμερα: χωρίς σύνδεση, tenantId από το body)");
test.todo("AUDIT: security headers (CSP frame-ancestors, HSTS, nosniff) στο next.config.js");
test.todo("AUDIT: καταγραφή (activity_logs) + όριο στην «Εμφάνιση» πλήρους αριθμού κάρτας");

// Ανοιχτά ευρήματα του audit (19/10/2026) — να γίνουν πραγματικά tests με τη διόρθωση.
test.todo("AUDIT: εταιρία SUSPENDED/CANCELLED μπλοκάρεται και ΜΕΤΑ το login (loadViewer → tenant.status)");
test.todo("AUDIT: /api/users/me/locale δεν ανανεώνει token ανενεργού χρήστη");
test.todo("AUDIT: όριο προσπαθειών στο /api/auth/login");
test.todo("AUDIT: CONFIRMED κράτηση με ληγμένη αναμονή πληρωμής ΣΥΝΕΧΙΖΕΙ να δεσμεύει το όχημα (notExpiredHold μόνο για PENDING)");
test.todo("AUDIT: κρατήσεις dashboard (POST/PATCH, walk-in) μέσα στο ίδιο advisory lock με το site");
test.todo("AUDIT: nextBookingNumber αριθμητικά (μετά το BP-YYYY-999) + UNIQUE (tenantId, bookingNumber)");
test.todo("AUDIT: η ποσότητα των πρόσθετων κρατιέται στην επανατιμολόγηση (requestFromBooking qty)");
