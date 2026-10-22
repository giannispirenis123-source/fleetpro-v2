// tests/custom-domain.test.mjs
// «Domain-ready»: δρομολόγηση ανά host (VERIFIED, PENDING, άγνωστο host, host
// άλλης εταιρίας), ασφάλεια host (καθάρισμα, κανένα header injection),
// canonical/hreflang/sitemap/robots με domain, links σε email/Stripe, επιλογή
// αποστολέα email (με και χωρίς επαλήθευση) και δικαιώματα των νέων οθονών.
// Χωρίς βάση (η βάση: Playwright τοπικά). Τρέχει με `npm test`.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const ROOT = new URL("../", import.meta.url).pathname;
const src = (p) => readFileSync(ROOT + p, "utf8");
/** Κώδικας χωρίς σχόλια γραμμής. */
const code = (p) => src(p).split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join("\n");

const domain = await import("../src/lib/storefront/domain.ts");
const { buildSiteUrl, basePathForOrigin, domainOrigin } = await import("../src/lib/storefront/siteUrl.ts");
const { sitePath, storefrontPath, canonicalSlug } = await import("../src/lib/storefront/slug.ts");
const { toPublicCompany } = await import("../src/lib/storefront/publicData.ts");
const seo = await import("../src/lib/storefront/seo.ts");
const sender = await import("../src/lib/emailSender.ts");

const ORIGIN = "https://fleetpro-app-eight.vercel.app";
const PLATFORM = ["fleetpro-app-eight.vercel.app"];

function tenant(over = {}) {
  return {
    storefrontSlug: "chania-cars",
    name: "Chania Cars",
    brandColor: "#123456",
    phone: null,
    email: null,
    address: null,
    region: null,
    rentalMode: "BOOKING",
    storefrontSettings: { supportedLanguages: ["el", "en"], defaultLanguage: "el" },
    customDomain: null,
    customDomainStatus: "PENDING",
    ...over,
  };
}

/* ─────────────────────────────────────────────
   Ασφάλεια host
   ───────────────────────────────────────────── */

test("normalizeHost: πεζά, χωρίς θύρα/τελεία· ό,τι άλλο → null", () => {
  assert.equal(domain.normalizeHost("WWW.Helios-Rent.GR"), "www.helios-rent.gr");
  assert.equal(domain.normalizeHost("a.localtest.me:3000"), "a.localtest.me");
  assert.equal(domain.normalizeHost("helios.gr."), "helios.gr");
  assert.equal(domain.normalizeHost("xn--hxajbheg2az3al.gr"), "xn--hxajbheg2az3al.gr");
  for (const bad of [
    "", "localhost", "helios", "127.0.0.1", "10.0.0.1:3000", "a..b.gr", "-a.gr", "a-.gr", "a.gr/x", "a.gr?x",
    "user@a.gr", "a_b.gr", "a b.gr", "a.gr\r\nX-Evil: 1", "a.gr\nset-cookie: x", "a.gr%0d%0a", "a.gr:99999999",
    "ελληνικά.gr", "a.123", `${"a".repeat(64)}.gr`, `${"a.".repeat(130)}gr`, null, undefined,
  ]) {
    assert.equal(domain.normalizeHost(bad), null, String(bad));
  }
});

test("requestHost: x-forwarded-host πρώτα, μόνο το πρώτο, καθαρό", () => {
  const h = (m) => (n) => m[n] ?? null;
  assert.equal(domain.requestHost(h({ host: "A.localtest.me:3000" })), "a.localtest.me");
  assert.equal(domain.requestHost(h({ "x-forwarded-host": "www.helios.gr, evil.gr", host: "x.vercel.app" })), "www.helios.gr");
  assert.equal(domain.requestHost(h({ host: "evil.gr\r\nx: y" })), null);
  assert.equal(domain.requestHost(h({})), null);
});

test("isPlatformHost: localhost, IP, *.vercel.app, env hosts → πλατφόρμα· όλα τα άλλα → domain εταιρίας", () => {
  for (const h of [null, "localhost", "app.localhost", "fleetpro-app-eight.vercel.app", "x-git-branch.vercel.app", "vercel.app"]) {
    assert.equal(domain.isPlatformHost(h, PLATFORM), true, String(h));
  }
  assert.equal(domain.isPlatformHost("fleetpro.gr", ["fleetpro.gr"]), true, "PLATFORM_URL");
  for (const h of ["www.helios-rent.gr", "a.localtest.me", "b.localtest.me"]) assert.equal(domain.isPlatformHost(h, PLATFORM), false, h);
  // Μη έγκυρο host → normalizeHost null → πλατφόρμα (σημερινή συμπεριφορά, κανένα header).
  assert.equal(domain.isPlatformHost(domain.normalizeHost("evil\r\n.gr"), PLATFORM), true);
});

test("platformHostsFromEnv/platformOrigin: από PLATFORM_URL ή VERCEL_*, χωρίς σκουπίδια", () => {
  const env = { PLATFORM_URL: "https://FleetPro.gr/", VERCEL_PROJECT_PRODUCTION_URL: "fleetpro-app-eight.vercel.app", VERCEL_URL: "x-1.vercel.app", VERCEL_BRANCH_URL: "bad host" };
  assert.deepEqual(domain.platformHostsFromEnv(env), ["fleetpro.gr", "fleetpro-app-eight.vercel.app", "x-1.vercel.app"]);
  assert.equal(domain.platformOrigin(env), "https://fleetpro.gr");
  assert.equal(domain.platformOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "fleetpro-app-eight.vercel.app" }), ORIGIN);
  assert.equal(domain.platformOrigin({ PLATFORM_URL: "javascript:alert(1)" }), null);
  assert.equal(domain.platformOrigin({}), null);
});

/* ─────────────────────────────────────────────
   Δρομολόγηση στο domain εταιρίας (middleware)
   ───────────────────────────────────────────── */

test("routeCustomDomain: μόνο το site — καθαρές διευθύνσεις → εσωτερικό /s/_domain/…", () => {
  const r = domain.routeCustomDomain;
  assert.deepEqual(r("/"), { kind: "rewrite", path: "/s/_domain" });
  assert.deepEqual(r("/el"), { kind: "rewrite", path: "/s/_domain/el" });
  assert.deepEqual(r("/en/search"), { kind: "rewrite", path: "/s/_domain/en/search" });
  assert.deepEqual(r("/el/booking/59YU-A7ZJ"), { kind: "rewrite", path: "/s/_domain/el/booking/59YU-A7ZJ" });
  assert.deepEqual(r("/el/places/balos"), { kind: "rewrite", path: "/s/_domain/el/places/balos" });
  assert.deepEqual(r("/sitemap.xml"), { kind: "rewrite", path: "/s/_domain/sitemap.xml" });
  assert.deepEqual(r("/robots.txt"), { kind: "rewrite", path: "/s/_domain/robots.txt" });
  assert.deepEqual(r("/v/abc"), { kind: "rewrite", path: "/s/_domain/v/abc" });
  // /s/<οποιοδήποτε slug>/… → το καθαρό (το domain κρίνει την εταιρία, ΠΟΤΕ το slug).
  assert.deepEqual(r("/s/other-company/el/search"), { kind: "redirect", path: "/el/search" });
  assert.deepEqual(r("/s/chania-cars"), { kind: "redirect", path: "/" });
  // Login/dashboard → login της πλατφόρμας· τα υπόλοιπα της πλατφόρμας → 404.
  assert.deepEqual(r("/login"), { kind: "login" });
  assert.deepEqual(r("/dashboard/bookings"), { kind: "login" });
  for (const p of ["/c/abcdefghijklmnopqrstuvwxyz012345", "/pay/done", "/api/bookings", "/api/public-site/domain", "/super-admin", "/print/x", "/api/stripe/connect/webhook"]) {
    assert.deepEqual(r(p), { kind: "notFound" }, p);
  }
  assert.deepEqual(r("/api/public/quote"), { kind: "pass" });
  assert.deepEqual(r("/api/public/booking"), { kind: "pass" });
  assert.deepEqual(r("/_next/data/x.json"), { kind: "pass" });
});

test("το /s/_domain δεν είναι ποτέ slug εταιρίας (ούτε canonical redirect)", () => {
  assert.equal(domain.DOMAIN_SLUG, "_domain");
  assert.equal(canonicalSlug("_domain"), null);
});

test("headers (noindex κ.λπ.): ΙΔΙΟΙ κανόνες για /s/<slug> και για το domain", () => {
  for (const base of ["/s/chania-cars", "/s/_domain"]) {
    assert.deepEqual(domain.siteResponseHeaders(`${base}/el/search`), [["X-Robots-Tag", "noindex, nofollow"]]);
    assert.deepEqual(domain.siteResponseHeaders(`${base}/en/book`), [["X-Robots-Tag", "noindex, nofollow"]]);
    assert.deepEqual(domain.siteResponseHeaders(`${base}/el/booking/X1`), [
      ["X-Robots-Tag", "noindex, nofollow, noarchive"],
      ["Cache-Control", "no-store, max-age=0"],
      ["Referrer-Policy", "no-referrer"],
    ]);
    assert.deepEqual(domain.siteResponseHeaders(`${base}/el`), []);
  }
});

test("middleware: header host ΜΟΝΟ από το middleware· σβήνεται πάντα το εισερχόμενο", () => {
  const mw = code("src/middleware.ts");
  // Σε κάθε διαδρομή προς το site: delete και μετά set μόνο με το καθαρό host.
  assert.match(mw, /headers\.delete\(SITE_HOST_HEADER\);\s*if \(siteHost\) headers\.set\(SITE_HOST_HEADER, siteHost\);/);
  // /api/public/* στο domain: χωρίς το header.
  assert.match(mw, /case "pass": \{\s*const headers = new Headers\(req\.headers\);\s*headers\.delete\(SITE_HOST_HEADER\);/);
  // Το /s/ της πλατφόρμας: siteHost = null.
  assert.match(mw, /siteRequestHeaders\(req, pathname, null\)/);
  // Ο έλεγχος host γίνεται ΠΡΙΝ από κάθε άλλο (και το /c/ στο domain δεν ανοίγει).
  assert.ok(mw.indexOf("isPlatformHost(") < mw.indexOf("PUBLIC_PAY_RE.test"));
  assert.ok(mw.indexOf("isPlatformHost(") < mw.indexOf("PUBLIC_CONTRACT_RE.test"));
});

test("resolve: εταιρία από domain ΜΟΝΟ με VERIFIED· _domain ΜΟΝΟ από το header του middleware", () => {
  const r = code("src/lib/storefront/resolve.ts");
  assert.match(r, /findTenant\(\{ customDomain: host, customDomainStatus: "VERIFIED" \}\)/);
  assert.match(r, /if \(param === DOMAIN_SLUG\) return resolveStorefrontByHost\(headers\(\)\.get\(SITE_HOST_HEADER\)\)/);
  assert.match(r, /const host = normalizeHost\(rawHost\);\s*if \(!host\) return null;/);
  // Ίδιος κανόνας ορατότητας (ενεργή σελίδα + publicSite) και για το domain.
  assert.match(r, /const visibility = storefrontRowVisibility\(tenant\);/);
  // Τα δημόσια API δέχονται ΜΟΝΟ slug (ποτέ _domain/header).
  for (const p of ["src/app/api/public/quote/route.ts", "src/lib/public/bookingSubmit.ts"]) {
    assert.doesNotMatch(code(p), /resolveStorefrontParam|SITE_HOST_HEADER/, p);
  }
});

/* ─────────────────────────────────────────────
   Δήλωση domain στο dashboard
   ───────────────────────────────────────────── */

test("validateCustomDomain: καθαρίζει ό,τι επικολλήθηκε, απορρίπτει θύρα/πλατφόρμα/IP", () => {
  const v = (x, hosts = PLATFORM) => domain.validateCustomDomain(x, hosts);
  assert.deepEqual(v("https://WWW.Helios-Rent.gr/el?x=1"), { ok: true, domain: "www.helios-rent.gr" });
  assert.deepEqual(v(" helios-rent.gr. "), { ok: true, domain: "helios-rent.gr" });
  for (const bad of ["helios-rent.gr:8080", "127.0.0.1", "localhost", "helios", "", "a b.gr", "a.gr\r\nx", 42, null]) {
    assert.equal(v(bad).ok, false, String(bad));
  }
  assert.equal(v("fleetpro-app-eight.vercel.app").reason, "platform");
  assert.equal(v("my-company.vercel.app").reason, "platform");
  assert.equal(v("fleetpro.gr", ["fleetpro.gr"]).reason, "platform", "PLATFORM_URL / host του dashboard");
});

test("checkDomainAvailability: domain άλλης εταιρίας → taken· το δικό της → ok", () => {
  assert.equal(domain.checkDomainAvailability("www.a.gr", "B", "A").reason, "taken");
  assert.deepEqual(domain.checkDomainAvailability("www.a.gr", "A", "A"), { ok: true, domain: "www.a.gr" });
  assert.deepEqual(domain.checkDomainAvailability("www.a.gr", null, "A"), { ok: true, domain: "www.a.gr" });
});

test("dnsPointsToApp: CNAME/A του Vercel → ok· αλλού ή τίποτα → όχι", () => {
  assert.deepEqual(domain.dnsPointsToApp({ cnames: ["cname.vercel-dns.com."], ips: [] }), { ok: true, via: "CNAME", value: "cname.vercel-dns.com" });
  assert.equal(domain.dnsPointsToApp({ cnames: ["d1d4fc829fe7bc7c.vercel-dns-017.com"], ips: [] }).ok, true);
  assert.deepEqual(domain.dnsPointsToApp({ cnames: [], ips: ["76.76.21.21"] }), { ok: true, via: "A", value: "76.76.21.21" });
  assert.equal(domain.dnsPointsToApp({ cnames: [], ips: ["216.198.79.1"] }).ok, true);
  assert.deepEqual(domain.dnsPointsToApp({ cnames: [], ips: [] }), { ok: false, reason: "no_records", found: [] });
  assert.deepEqual(domain.dnsPointsToApp({ cnames: [], ips: ["127.0.0.1"] }), { ok: false, reason: "elsewhere", found: ["127.0.0.1"] });
  // Ψεύτικο «vercel-dns» σε άλλο domain δεν περνά.
  assert.equal(domain.dnsPointsToApp({ cnames: ["vercel-dns.com.evil.gr", "notvercel-dns.com"], ips: ["76.76.22.1"] }).ok, false);
});

test("dnsInstructions: σκέτο domain → A, υποτομέας → CNAME", () => {
  assert.deepEqual(domain.dnsInstructions("helios-rent.gr"), { type: "A", name: "@", value: "76.76.21.21" });
  assert.deepEqual(domain.dnsInstructions("helios.com.gr"), { type: "A", name: "@", value: "76.76.21.21" });
  assert.deepEqual(domain.dnsInstructions("www.helios-rent.gr"), { type: "CNAME", name: "www", value: "cname.vercel-dns.com" });
  assert.deepEqual(domain.dnsInstructions("www.helios.com.gr"), { type: "CNAME", name: "www", value: "cname.vercel-dns.com" });
});

/* ─────────────────────────────────────────────
   Απόλυτα URL: canonical, hreflang, sitemap, robots, email, Stripe
   ───────────────────────────────────────────── */

test("buildSiteUrl: χωρίς domain ΑΚΡΙΒΩΣ όπως πριν (/s/<slug>/…)", () => {
  const c = toPublicCompany(tenant(), null);
  assert.equal(buildSiteUrl(ORIGIN, c, { lang: "el" }), `${ORIGIN}/s/chania-cars/el`);
  assert.equal(buildSiteUrl(ORIGIN, c, { lang: "en", page: "terms" }), `${ORIGIN}/s/chania-cars/en/terms`);
  assert.equal(buildSiteUrl(ORIGIN, c, { lang: "el", page: { bookingCode: "59YU-A7ZJ" } }), `${ORIGIN}/s/chania-cars/el/booking/59YU-A7ZJ`);
  assert.equal(buildSiteUrl(ORIGIN, c, { file: "sitemap.xml" }), `${ORIGIN}/s/chania-cars/sitemap.xml`);
  // PENDING: ίδιο με «χωρίς domain».
  const pending = toPublicCompany(tenant({ customDomain: "www.chania-cars.gr", customDomainStatus: "PENDING" }), null);
  assert.equal(buildSiteUrl(ORIGIN, pending, { lang: "el" }), `${ORIGIN}/s/chania-cars/el`);
  assert.equal(domainOrigin(pending), null);
});

test("buildSiteUrl: VERIFIED domain → https://domain/<lang>/… από ΟΠΟΙΟ host κι αν ήρθε (canonical)", () => {
  const verified = tenant({ customDomain: "www.chania-cars.gr", customDomainStatus: "VERIFIED" });
  for (const c of [toPublicCompany(verified, null), toPublicCompany(verified, null, { onDomain: true, platformOrigin: ORIGIN })]) {
    assert.equal(buildSiteUrl(ORIGIN, c, { lang: "el" }), "https://www.chania-cars.gr/el");
    assert.equal(buildSiteUrl("http://localhost:3000", c, { lang: "en", page: { placeSlug: "balos" } }), "https://www.chania-cars.gr/en/places/balos");
    assert.equal(buildSiteUrl(ORIGIN, c, { lang: "el", page: { bookingCode: "X1" } }), "https://www.chania-cars.gr/el/booking/X1");
    assert.equal(buildSiteUrl(ORIGIN, c, { file: "sitemap.xml" }), "https://www.chania-cars.gr/sitemap.xml");
    assert.equal(buildSiteUrl(ORIGIN, c, { file: "robots.txt" }), "https://www.chania-cars.gr/robots.txt");
  }
});

test("canonical/hreflang/OG στο domain (και από το /s/<slug> της εταιρίας με domain)", () => {
  const c = toPublicCompany(tenant({ customDomain: "www.chania-cars.gr", customDomainStatus: "VERIFIED" }), null);
  const m = seo.indexablePage({ company: c, lang: "en", title: "T", description: "D", url: (l) => buildSiteUrl(ORIGIN, c, { lang: l }) });
  assert.equal(m.alternates.canonical, "https://www.chania-cars.gr/en");
  assert.deepEqual(m.alternates.languages, { el: "https://www.chania-cars.gr/el", en: "https://www.chania-cars.gr/en", "x-default": "https://www.chania-cars.gr/el" });
  assert.equal(m.openGraph.url, "https://www.chania-cars.gr/en");
});

test("sitemap/robots με domain: όλα τα URL στο domain, τίποτα στο /s/ ή στην πλατφόρμα", () => {
  const c = toPublicCompany(tenant({ customDomain: "www.chania-cars.gr", customDomainStatus: "VERIFIED" }), null);
  const xml = seo.buildSitemap(c, { places: [{ slug: "balos", updated: "2026-10-01" }], legal: {} }, (lang, page) => buildSiteUrl(ORIGIN, c, { lang, page }));
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 4);
  for (const l of locs) assert.match(l, /^https:\/\/www\.chania-cars\.gr\/(el|en)(\/|$)/);
  assert.ok(!xml.includes("/s/") && !xml.includes("vercel.app"));
  const root = buildSiteUrl(ORIGIN, c, { lang: "el" });
  const txt = seo.robotsTxt(root.replace(/\/[a-z]{2}$/, "/"), buildSiteUrl(ORIGIN, c, { file: "sitemap.xml" }));
  assert.equal(txt, "User-agent: *\nAllow: /\n\nSitemap: https://www.chania-cars.gr/sitemap.xml\n");
});

test("sitePath: links σωστά και στο /s/<slug> και στο domain", () => {
  const onSlug = { slug: "chania-cars", basePath: "/s/chania-cars" };
  const onDomain = { slug: "chania-cars", basePath: "" };
  assert.equal(sitePath(onSlug, "el", "search", "pl=a"), "/s/chania-cars/el/search?pl=a");
  assert.equal(sitePath(onDomain, "el", "search", "pl=a"), "/el/search?pl=a");
  assert.equal(sitePath(onDomain, "en", { vehicleId: "v1" }), "/en/v/v1");
  assert.equal(sitePath(onDomain, "en", { bookingCode: "X1" }), "/en/booking/X1");
  assert.equal(sitePath({ slug: "chania-cars" }, "el"), "/s/chania-cars/el", "χωρίς basePath = όπως πριν");
  assert.equal(storefrontPath("chania-cars", "el", "terms"), "/s/chania-cars/el/terms");
});

test("μετά την κράτηση/επιστροφή: ίδιο host με τη φόρμα· email και Stripe → domain", () => {
  const c = { slug: "chania-cars", siteDomain: "www.chania-cars.gr" };
  assert.equal(basePathForOrigin("https://www.chania-cars.gr", c), "");
  assert.equal(basePathForOrigin(ORIGIN, c), "/s/chania-cars");
  assert.equal(basePathForOrigin("https://www.other.gr", c), "/s/chania-cars", "host άλλης εταιρίας");
  assert.equal(basePathForOrigin("", c), "/s/chania-cars");
  assert.equal(basePathForOrigin("https://www.chania-cars.gr", { slug: "chania-cars", siteDomain: null }), "/s/chania-cars");
  // Οι τρεις ροές περνούν από το ΕΝΑ σημείο (siteUrl.ts), με το domain ΜΟΝΟ αν είναι VERIFIED.
  assert.match(code("src/lib/public/paymentServer.ts"), /siteDomain: verifiedDomainOf\(b\.tenant\)[\s\S]*buildSiteUrl\(opts\.origin, site, \{ lang, page: \{ bookingCode: opts\.code \} \}\)/);
  assert.match(code("src/lib/bookingDecisionServer.ts"), /bookingUrl: site && b\.publicCode \? buildSiteUrl\(origin, site,/);
  assert.match(code("src/lib/public/bookingSubmit.ts"), /basePath: basePathForOrigin\(origin, resolved\.company\)/);
});

test("footer «Είσοδος προσωπικού»: /login στην πλατφόρμα, login της πλατφόρμας στο domain", () => {
  assert.equal(toPublicCompany(tenant(), null).loginUrl, "/login");
  assert.equal(toPublicCompany(tenant(), null, { onDomain: true, platformOrigin: ORIGIN }).loginUrl, `${ORIGIN}/login`);
  assert.match(src("src/components/storefront/StorefrontViews.tsx"), /company\.loginUrl && \(/);
});

/* ─────────────────────────────────────────────
   Δικαιώματα των νέων οθονών
   ───────────────────────────────────────────── */

test("API domain: ΜΟΝΟ Διαχειριστής με publicSite, εταιρία από τη συνεδρία, όχι από το body", () => {
  for (const p of ["src/app/api/public-site/domain/route.ts", "src/app/api/public-site/domain/verify/route.ts"]) {
    const s = code(p);
    const handlers = [...s.matchAll(/export const (GET|PUT|POST|DELETE) = withPermission\(/g)].map((m) => m[1]);
    assert.ok(handlers.length >= 1, p);
    assert.equal((s.match(/const access = await storefrontAccess\(viewer\);\s*if \(!access\.ok\) return forbidden\(access\.message\);/g) ?? []).length, handlers.length, p);
    assert.equal((s.match(/\}, "settings\.edit"\);/g) ?? []).length, handlers.length, p);
    assert.doesNotMatch(s, /companyId: .*body|tenantId: .*body/);
  }
  // Ο έλεγχος κάνει lookup ΜΟΝΟ στο domain της ίδιας εταιρίας (από τη βάση).
  const srv = code("src/lib/storefront/domainServer.ts");
  assert.match(srv, /export async function verifyDomain\(\s*companyId: string,/);
  assert.match(srv, /db\.tenant\.findUnique\(\{ where: \{ id: companyId \}, select: \{ customDomain: true \} \}\)/);
  assert.match(srv, /withTimeout\(p, TIMEOUTS\.dns, "dns"\)/);
  // Αποτυχία ελέγχου ΔΕΝ γράφει τίποτα (μόνο το ok γράφει VERIFIED).
  assert.match(srv, /if \(verdict\.ok\) \{[\s\S]*customDomainStatus: "VERIFIED"/);
  // Μοναδικότητα: έλεγχος + UNIQUE (P2002 → 409).
  assert.match(srv, /e\.code === "P2002"/);
});

test("API αποστολέα: ΜΟΝΟ Διαχειριστής (ρόλος), εταιρία από τη συνεδρία", () => {
  const s = code("src/app/api/settings/email-sender/route.ts");
  assert.match(s, /viewer\?\.tenantId && viewer\.role === "COMPANY_ADMIN" \? viewer\.tenantId : null/);
  assert.equal((s.match(/if \(!tenantId\) return forbidden\(ONLY_ADMIN\);/g) ?? []).length, 2);
  assert.equal((s.match(/\}, "settings\.edit"\);/g) ?? []).length, 2);
  assert.match(code("src/app/(dashboard)/dashboard/settings/page.tsx"), /viewer\.role === "COMPANY_ADMIN" && <EmailSenderSettings \/>/);
});

test("Super Admin δεν αλλάζει πια το customDomain χωρίς ελέγχους", () => {
  assert.doesNotMatch(code("src/app/api/tenants/[id]/route.ts"), /customDomain/);
  assert.doesNotMatch(code("src/app/(super-admin)/super-admin/page.tsx"), /customDomain/);
});

/* ─────────────────────────────────────────────
   Αποστολέας email
   ───────────────────────────────────────────── */

const FALLBACK = "FleetPro <onboarding@resend.dev>";

test("chooseEmailFrom: VERIFIED → της εταιρίας· αλλιώς EMAIL_FROM όπως σήμερα", () => {
  const t = (over) => ({ emailFromName: "Helios Rent", emailFromAddress: "bookings@helios-rent.gr", emailSenderStatus: "VERIFIED", ...over });
  assert.equal(sender.chooseEmailFrom(t(), FALLBACK), '"Helios Rent" <bookings@helios-rent.gr>');
  assert.equal(sender.chooseEmailFrom(t({ emailFromName: null }), FALLBACK), "bookings@helios-rent.gr");
  assert.equal(sender.chooseEmailFrom(t({ emailSenderStatus: "UNVERIFIED" }), FALLBACK), FALLBACK);
  assert.equal(sender.chooseEmailFrom(t({ emailFromAddress: null }), FALLBACK), FALLBACK);
  assert.equal(sender.chooseEmailFrom(t({ emailFromAddress: "not an email" }), FALLBACK), FALLBACK);
  assert.equal(sender.chooseEmailFrom(null, FALLBACK), FALLBACK);
  assert.equal(sender.chooseEmailFrom(undefined, undefined), undefined, "χωρίς EMAIL_FROM → not_configured όπως πριν");
});

test("αποστολέας: κανένα header injection από όνομα ή διεύθυνση", () => {
  assert.equal(sender.formatSender('Evil"\r\nBcc: x@y.gr <a>', "a@b.gr"), '"Evil Bcc: x@y.gr a" <a@b.gr>');
  for (const bad of ["a@b.gr\r\nBcc: x@y.gr", "a@b.gr>", "<a@b.gr>", "a b@c.gr", "a@b", "a@-b.gr", "@b.gr", `${"a".repeat(65)}@b.gr`]) {
    assert.equal(sender.normalizeSenderAddress(bad), null, bad);
    assert.equal(sender.formatSender("X", bad), null, bad);
  }
  assert.equal(sender.normalizeSenderAddress(" Bookings@Helios-Rent.GR "), "bookings@helios-rent.gr");
  assert.equal(sender.sanitizeSenderName("x".repeat(200)).length, 80);
  assert.equal(sender.senderDomain("bookings@mail.helios.gr"), "mail.helios.gr");
  assert.equal(sender.emailSenderSchema.safeParse({ name: "A", address: "bad", verified: true }).success, false);
  assert.equal(sender.emailSenderSchema.safeParse({ name: "", address: "", verified: false }).success, true);
});

test("τα 3 σημεία αποστολής περνούν από emailFromForTenant — κανένα δεν διαβάζει πια το EMAIL_FROM", () => {
  for (const p of ["src/app/api/contracts/[id]/email/route.ts", "src/app/api/invoices/[id]/email/route.ts", "src/app/api/bookings/[id]/decision/route.ts"]) {
    const s = code(p);
    assert.match(s, /await emailFromForTenant\((viewer!\.tenantId|tenantId)\)/, p);
    assert.doesNotMatch(s, /process\.env\.EMAIL_FROM/, p);
  }
  assert.doesNotMatch(code("src/lib/bookingDecisionServer.ts"), /process\.env\.EMAIL_FROM/);
  const srv = code("src/lib/emailSenderServer.ts");
  assert.match(srv, /const fallback = process\.env\.EMAIL_FROM;/);
  assert.match(srv, /return chooseEmailFrom\(t, fallback\);/);
  // VERIFIED μόνο με έγκυρη διεύθυνση.
  assert.match(srv, /const verified = input\.verified && address !== null;/);
});
