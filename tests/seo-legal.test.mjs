// tests/seo-legal.test.mjs
// Δημόσιο site — SEO και νομικά: meta/canonical/hreflang, sitemap (μόνο
// επιτρεπτές σελίδες), robots, schema.org, απομόνωση εταιριών (οι όροι της Α
// ποτέ στη Β), έκδοση όρων στην κράτηση, δικαιώματα της καρτέλας «Νομικά»,
// markdown χωρίς raw HTML. Χωρίς βάση. Τρέχει με `npm test`.

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

const { buildSiteUrl, originFromHeaders } = await import("../src/lib/storefront/siteUrl.ts");
const seo = await import("../src/lib/storefront/seo.ts");
const { toPublicCompany } = await import("../src/lib/storefront/publicData.ts");
const { normalizeStorefrontSettings, mergeStorefrontSettings } = await import("../src/lib/storefront/settings.ts");
const legal = await import("../src/lib/legal/legal.ts");
const { TEMPLATE_VERSION, TEMPLATE_UPDATED, LEGAL_TEMPLATES } = await import("../src/lib/legal/templates.ts");
const { parseMarkdown, parseInline, safeHref, plainText } = await import("../src/lib/legal/markdown.ts");
const { aggregateRatingJsonLd } = await import("../src/lib/public/reviews.ts");
const { writeSiteBooking } = await import("../src/lib/public/bookingWrite.ts");

const ORIGIN = "https://fleetpro-app-eight.vercel.app";
const HERO = "https://res.cloudinary.com/demo/image/upload/v1/fleetpro/A/site/hero/x.jpg";

function company(over = {}, settings = {}) {
  return toPublicCompany(
    {
      storefrontSlug: "chania-cars",
      name: "Chania Cars",
      brandColor: "#123456",
      phone: "+30 28210 00000",
      email: "info@chania.example",
      address: "Οδός 1",
      region: "Χανιά",
      rentalMode: "BOOKING",
      storefrontSettings: {
        supportedLanguages: ["el", "en"],
        defaultLanguage: "el",
        theme: { heroImage: { url: HERO, publicId: "secret/id" }, heroTitle: { el: "Ενοικίαση αυτοκινήτων", en: "Car hire" }, heroSubtitle: { el: "Στα Χανιά", en: "In Chania" } },
        ...settings,
      },
      ...over,
    },
    over.logo ?? null
  );
}

const urlFor = (c, page = "") => (lang) => buildSiteUrl(ORIGIN, c, { lang, page });

/* ─────────────────────────────────────────────
   Απόλυτα URL — ΜΙΑ συνάρτηση
   ───────────────────────────────────────────── */

test("siteUrl: σελίδες και αρχεία από το ίδιο σημείο", () => {
  const c = { slug: "chania-cars" };
  assert.equal(buildSiteUrl(ORIGIN, c, { lang: "el" }), `${ORIGIN}/s/chania-cars/el`);
  assert.equal(buildSiteUrl(ORIGIN + "/", c, { lang: "en", page: "terms" }), `${ORIGIN}/s/chania-cars/en/terms`);
  assert.equal(buildSiteUrl(ORIGIN, c, { lang: "el", page: { placeSlug: "balos" } }), `${ORIGIN}/s/chania-cars/el/places/balos`);
  assert.equal(buildSiteUrl(ORIGIN, c, { file: "sitemap.xml" }), `${ORIGIN}/s/chania-cars/sitemap.xml`);
  assert.equal(buildSiteUrl(ORIGIN, c, { file: "robots.txt" }), `${ORIGIN}/s/chania-cars/robots.txt`);
});

test("siteUrl: origin από τα headers· άκυρο host δεν περνά", () => {
  const h = (o) => (n) => o[n] ?? null;
  assert.equal(originFromHeaders(h({ "x-forwarded-host": "a.vercel.app", "x-forwarded-proto": "https" })), "https://a.vercel.app");
  assert.equal(originFromHeaders(h({ host: "localhost:3000" })), "http://localhost:3000");
  assert.equal(originFromHeaders(h({ host: "evil.com/<script>" })), null);
  assert.equal(originFromHeaders(h({})), null);
  // Κανένα άλλο αρχείο του site δεν συνθέτει απόλυτα URL από τα headers.
  assert.doesNotMatch(src("src/lib/storefront/routes.tsx"), /x-forwarded-host|function absoluteUrl/);
  assert.match(src("src/lib/storefront/siteUrlServer.ts"), /buildSiteUrl\(requestOrigin\(\), company, target\)/);
});

/* ─────────────────────────────────────────────
   meta / canonical / hreflang / OG
   ───────────────────────────────────────────── */

test("αρχική: canonical, hreflang el/en + x-default (= προεπιλεγμένη), OG/Twitter με το hero", () => {
  const c = company();
  const m = seo.indexablePage({ company: c, lang: "en", title: seo.homeSeoTitle(c, "en"), description: seo.homeSeoDescription(c, "en"), url: urlFor(c) });
  assert.equal(m.alternates.canonical, `${ORIGIN}/s/chania-cars/en`);
  assert.deepEqual(m.alternates.languages, {
    el: `${ORIGIN}/s/chania-cars/el`,
    en: `${ORIGIN}/s/chania-cars/en`,
    "x-default": `${ORIGIN}/s/chania-cars/el`,
  });
  assert.deepEqual(m.robots, { index: true, follow: true });
  assert.equal(m.openGraph.url, `${ORIGIN}/s/chania-cars/en`);
  assert.equal(m.openGraph.locale, "en_GB");
  assert.deepEqual(m.openGraph.alternateLocale, ["el_GR"]);
  assert.equal(m.openGraph.siteName, "Chania Cars");
  assert.match(m.openGraph.images[0].url, /res\.cloudinary\.com\/demo\/image\/upload\/f_auto,q_auto,c_limit,w_1200\//);
  assert.equal(m.twitter.card, "summary_large_image");
  assert.equal(m.title.absolute, "Car hire — Chania Cars");
  assert.equal(m.description, "In Chania");
  assert.equal(m.keywords, null, "όχι τα keywords της πλατφόρμας");
  assert.doesNotMatch(JSON.stringify(m), /secret\/id|FleetPro/);
});

test("χωρίς hero → λογότυπο· χωρίς τίποτα → card summary χωρίς εικόνα", () => {
  const withLogo = company({ logo: "https://storage.example/logo.png" }, { theme: {} });
  assert.equal(seo.socialImage(withLogo).url, "https://storage.example/logo.png");
  const bare = company({}, { theme: {} });
  const m = seo.indexablePage({ company: bare, lang: "el", title: "x", url: urlFor(bare) });
  assert.equal(m.openGraph.images, undefined);
  assert.equal(m.twitter.card, "summary");
});

test("πεδία SEO ανά γλώσσα: υπερισχύουν· κενά → λογικές προεπιλογές· όρια 70/160", () => {
  const c = company({}, { seoTitle: { el: "Ενοικίαση αυτοκινήτων Χανιά | Chania Cars" }, seoDescription: { en: "Best rates in Chania." } });
  assert.equal(seo.homeSeoTitle(c, "el"), "Ενοικίαση αυτοκινήτων Χανιά | Chania Cars");
  assert.equal(seo.homeSeoTitle(c, "en"), "Car hire — Chania Cars", "κενό EN → τίτλος hero");
  assert.equal(seo.homeSeoDescription(c, "en"), "Best rates in Chania.");
  assert.equal(seo.homeSeoDescription(c, "el"), "Στα Χανιά", "κενό EL → υπότιτλος hero");
  const bare = company({}, { theme: {} });
  assert.equal(seo.homeSeoTitle(bare, "el"), "Chania Cars");
  assert.equal(seo.homeSeoDescription(bare, "el"), "Ενοικίαση αυτοκινήτων από την Chania Cars — Χανιά. Δείτε τιμές και διαθεσιμότητα και κάντε κράτηση online.");
  const long = seo.clip("λέξη ".repeat(60), 160);
  assert.ok(long.length <= 160 && long.endsWith("…"));
  // Αποθήκευση από το «Η σελίδα μου»: κανονικοποίηση και καθάρισμα.
  const s = mergeStorefrontSettings(normalizeStorefrontSettings({}), { seoTitle: { el: "  Τίτλος  ", xx: "όχι" }, seoDescription: { en: "x".repeat(400) } });
  assert.deepEqual(s.seoTitle, { el: "Τίτλος" });
  assert.equal(s.seoDescription.en.length, 160);
  assert.deepEqual(mergeStorefrontSettings(s, { seoTitle: {} }).seoTitle, {}, "κενό = πίσω στην προεπιλογή");
});

test("noindex σελίδες (search/book/booking/όχημα): robots noindex, χωρίς canonical/OG", () => {
  const m = seo.noindexPage("Αποτελέσματα — Chania Cars");
  assert.deepEqual(m.robots, { index: false, follow: false });
  assert.equal(m.alternates, undefined);
  assert.equal(m.openGraph, undefined);
  const routes = src("src/lib/storefront/routes.tsx");
  for (const fn of ["storefrontSearchMetadata", "storefrontBookMetadata", "storefrontConfirmationMetadata", "storefrontVehicleMetadata"]) {
    const body = routes.slice(routes.indexOf(`export async function ${fn}`)).split("\nexport ")[0];
    assert.match(body, /noindexPage\(/, fn);
    assert.doesNotMatch(body, /indexablePage\(/, fn);
  }
  // Και στο middleware (header) — όπως πριν.
  const mw = src("src/middleware.ts");
  assert.match(mw, /\(search\|book\)/);
  assert.match(mw, /booking\\\/\[\^\/\]\+/);
});

test("404 (άγνωστο slug / ανενεργή σελίδα): ίδιο, χωρίς meta της πλατφόρμας ή της εταιρίας", () => {
  const layout = src("src/app/(storefront)/s/[slug]/layout.tsx");
  assert.match(layout, /title: "404"/);
  assert.match(layout, /description: null/);
  assert.match(layout, /keywords: null/);
  assert.match(layout, /index: false/);
  const nf = code("src/app/(storefront)/s/[slug]/not-found.tsx");
  assert.doesNotMatch(nf, /FleetPro|company|slug|params/);
  // Νομικά/sitemap/robots: εταιρία ΜΟΝΟ μέσω resolveStorefrontCompany/openStorefront → 404.
  const sr = src("src/lib/storefront/seoRoutes.ts");
  assert.equal((sr.match(/resolveStorefrontCompany\(slug\)/g) ?? []).length, 2);
  assert.equal((sr.match(/if \(!r\) return notFoundText\(\)/g) ?? []).length, 2);
});

/* ─────────────────────────────────────────────
   sitemap / robots
   ───────────────────────────────────────────── */

test("sitemap: ΜΟΝΟ αρχική, ενεργά μέρη, νομικά — σε κάθε γλώσσα, με hreflang", () => {
  const c = company();
  const xml = seo.buildSitemap(
    c,
    { places: [{ slug: "balos", updated: "2026-10-01" }], legal: { terms: { el: "2026-10-20" } } },
    (lang, page) => buildSiteUrl(ORIGIN, c, { lang, page })
  );
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(`${ORIGIN}/s/chania-cars`, ""));
  assert.deepEqual(locs, [
    "/el", "/en",
    "/el/places/balos", "/en/places/balos",
    "/el/terms", "/en/terms",
    "/el/privacy", "/en/privacy",
    "/el/cookies", "/en/cookies",
  ]);
  for (const bad of ["/search", "/book", "/booking/", "/c/", "/pay", "/v/"]) assert.ok(!xml.includes(bad), bad);
  assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(xml, /hreflang="x-default" href="https:\/\/fleetpro-app-eight\.vercel\.app\/s\/chania-cars\/el"/);
  // lastmod: δικό τους κείμενο (el) / πρότυπο (en).
  assert.match(xml, /<loc>[^<]+\/el\/terms<\/loc>\n    <lastmod>2026-10-20<\/lastmod>/);
  assert.match(xml, new RegExp(`<loc>[^<]+/en/terms</loc>\\n    <lastmod>${TEMPLATE_UPDATED}</lastmod>`));
});

test("sitemap: μόνο οι γλώσσες της εταιρίας· escape στα URL", () => {
  const c = company({}, { supportedLanguages: ["en"], defaultLanguage: "en" });
  const xml = seo.buildSitemap(c, { places: [], legal: {} }, (lang, page) => buildSiteUrl("https://x.example", c, { lang, page, query: "a=1&b=2" }));
  assert.ok(!xml.includes("/el"));
  assert.ok(xml.includes("a=1&amp;b=2") && !xml.includes("a=1&b"));
});

test("sitemap: ενεργά μέρη μόνο της εταιρίας (ερώτημα με tenantId + isActive)", () => {
  const s = src("src/lib/storefront/seoServer.ts");
  assert.match(s, /db\.place\.findMany\(\{\s*where: \{ tenantId: companyId, isActive: true \}/);
  assert.match(s, /db\.siteLegalText\.findMany\(\{\s*where: \{ tenantId: companyId \}/);
  assert.match(s, /db\.pickupLocation\.findMany\(\{\s*where: \{ tenantId: companyId, isActive: true \}/);
});

test("robots.txt της εταιρίας: Allow στο site της + Sitemap", () => {
  const txt = seo.robotsTxt(`${ORIGIN}/s/chania-cars/`, `${ORIGIN}/s/chania-cars/sitemap.xml`);
  assert.equal(txt, `User-agent: *\nAllow: /s/chania-cars/\n\nSitemap: ${ORIGIN}/s/chania-cars/sitemap.xml\n`);
});

/* ─────────────────────────────────────────────
   schema.org
   ───────────────────────────────────────────── */

test("AutoRental: επωνυμία, διεύθυνση, τηλέφωνο, ώρες, τοποθεσίες + το AggregateRating ΑΚΡΙΒΩΣ όπως πριν", () => {
  const c = company();
  const reviews = aggregateRatingJsonLd({ name: c.name, url: `${ORIGIN}/s/chania-cars/el` }, [{ rating: 5 }, { rating: 4 }]);
  const ld = seo.businessJsonLd({
    company: c,
    url: `${ORIGIN}/s/chania-cars/el`,
    contact: { phone: "+30 28210 00000", email: "info@chania.example", address: "Οδός 1, Χανιά" },
    locations: [
      { name: "Αεροδρόμιο Χανίων", address: null, lat: 35.53, lng: 24.15 },
      { name: "Κίσσαμος", address: "Λιμάνι", lat: null, lng: null },
    ],
    reviewsJsonLd: reviews,
  });
  assert.equal(ld["@type"], "AutoRental");
  assert.equal(ld.name, "Chania Cars");
  assert.equal(ld.telephone, "+30 28210 00000");
  assert.deepEqual(ld.address, { "@type": "PostalAddress", streetAddress: "Οδός 1, Χανιά", addressRegion: "Χανιά" });
  assert.deepEqual(ld.openingHoursSpecification[0].opens, "07:00");
  assert.deepEqual(ld.openingHoursSpecification[0].closes, "23:00");
  assert.equal(ld.areaServed.length, 2);
  assert.deepEqual(ld.areaServed[0].geo, { "@type": "GeoCoordinates", latitude: 35.53, longitude: 24.15 });
  assert.deepEqual(ld.aggregateRating, reviews.aggregateRating);
  assert.equal(ld.aggregateRating.ratingValue, 4.5);
  // Χωρίς κριτικές → χωρίς aggregateRating (ποτέ ψεύτικο).
  assert.equal(seo.businessJsonLd({ company: c, url: "u", contact: { phone: null, email: null, address: null }, locations: [], reviewsJsonLd: null }).aggregateRating, undefined);
  // «<» δεν κλείνει το <script>.
  assert.ok(!seo.jsonLdText({ name: "</script><script>alert(1)</script>" }).includes("</script>"));
});

/* ─────────────────────────────────────────────
   Νομικά: πρότυπα, απομόνωση, έκδοση
   ───────────────────────────────────────────── */

const A = { name: "Alpha Rent", vat: "111111111", taxOffice: "Χανίων", address: "Οδός Α 1, Χανιά", email: "a@alpha.example", phone: "2821000001" };
const B = { name: "Beta Rent", vat: "222222222", taxOffice: "Ηρακλείου", address: "Οδός Β 2, Ηράκλειο", email: "b@beta.example", phone: "2810000002" };
const row = (tenantId, kind, lang, version, body, day = "2026-10-20") => ({ tenantId, kind, lang, version, body, createdAt: new Date(`${day}T10:00:00Z`) });

test("πρότυπα ΕΛ/EN: γεμίζουν με τα στοιχεία της εταιρίας (επωνυμία, ΑΦΜ, διεύθυνση, email)", () => {
  for (const kind of legal.LEGAL_KINDS) {
    for (const lang of ["el", "en"]) {
      const d = legal.resolveLegalDoc("A", [], kind, lang, A);
      assert.equal(d.isTemplate, true);
      assert.equal(d.versionId, `${kind}/${lang}/template-${TEMPLATE_VERSION}`);
      assert.equal(d.updated, TEMPLATE_UPDATED);
      assert.ok(d.body.includes("Alpha Rent"), `${kind}/${lang}`);
      assert.ok(!/\{\{\w+\}\}/.test(d.body), `${kind}/${lang}: έμεινε placeholder`);
      assert.ok(!d.body.includes("Beta"));
    }
  }
  const terms = legal.resolveLegalDoc("A", [], "terms", "el", A).body;
  for (const v of ["111111111", "Οδός Α 1, Χανιά", "a@alpha.example"]) assert.ok(terms.includes(v), v);
  // Λείπει ΑΦΜ → «—» και προειδοποίηση στο dashboard.
  assert.ok(legal.fillPlaceholders("ΑΦΜ {{vat}} {{unknown}}", { ...A, vat: null }).includes("ΑΦΜ — {{unknown}}"));
  assert.deepEqual(legal.missingCompanyFields({ ...A, vat: "", phone: null }), ["vat", "phone"]);
  // Άλλη γλώσσα (π.χ. fr) → αγγλικό πρότυπο.
  assert.equal(legal.resolveLegalDoc("A", [], "privacy", "fr", A).lang, "en");
});

test("απομόνωση: οι όροι της Α ΠΟΤΕ στη Β (ούτε αν μπλεχτούν γραμμές), ούτε τα στοιχεία της", () => {
  const rows = [
    row("A", "terms", "el", 1, "# Όροι Α\n\nΜυστική ρήτρα της Alpha {{company}}"),
    row("A", "terms", "el", 2, "# Όροι Α v2\n\nΡήτρα Alpha v2 — {{vat}}"),
    row("B", "terms", "el", 1, "# Όροι Β\n\nΡήτρα Beta — {{company}}"),
  ];
  const a = legal.resolveLegalDoc("A", rows, "terms", "el", A);
  const b = legal.resolveLegalDoc("B", rows, "terms", "el", B);
  assert.equal(a.versionId, "terms/el/v2");
  assert.ok(a.body.includes("Ρήτρα Alpha v2 — 111111111"));
  assert.equal(b.versionId, "terms/el/v1");
  assert.ok(b.body.includes("Ρήτρα Beta — Beta Rent"));
  assert.ok(!/Alpha|111111111/.test(b.body), "τίποτα της Α στη Β");
  // Η Γ (χωρίς δικά της) παίρνει πρότυπο — όχι κείμενο της Α ή της Β.
  const c = legal.resolveLegalDoc("C", rows, "terms", "el", { ...B, name: "Gamma" });
  assert.equal(c.isTemplate, true);
  assert.ok(!/Alpha|Beta Rent|Μυστική/.test(c.body));
  // Αγγλικό χωρίς δικό τους → πρότυπο (όχι το ελληνικό τους).
  assert.equal(legal.resolveLegalDoc("A", rows, "terms", "en", A).isTemplate, true);
});

test("απομόνωση στον server: κάθε ερώτημα νομικών με tenantId = companyId (slug/συνεδρία), ποτέ από URL/body", () => {
  const s = src("src/lib/legal/legalServer.ts");
  const queries = s.match(/db\.(siteLegalText|tenant)\.\w+\(\{[\s\S]*?where: \{[^}]*\}/g) ?? [];
  assert.ok(queries.length >= 2);
  for (const q of queries) assert.match(q, /(tenantId|id): companyId/, q);
  assert.match(s, /tx\.siteLegalText\.findFirst\(\{\s*where: \{ tenantId: companyId, kind, lang \}/);
  assert.match(s, /data: \{ tenantId: companyId, kind, lang,/);
  const routes = src("src/lib/storefront/routes.tsx");
  assert.match(routes, /const \{ company, companyId, lang \} = await openStorefront\(p\.slug, p\.lang, kind\);\s*\/\/[^\n]*\n\s*const doc = isLegalKind\(kind\) \? await loadLegalDoc\(companyId, kind, lang\)/);
  for (const k of ["terms", "privacy", "cookies"]) {
    const page = src(`src/app/(storefront)/s/[slug]/[lang]/${k}/page.tsx`);
    assert.match(page, new RegExp(`storefrontLegalMetadata\\(params, "${k}"\\)`));
    assert.match(page, new RegExp(`StorefrontLegalPage\\(\\{ params, kind: "${k}" \\}\\)`));
  }
});

test("έκδοση όρων: η κράτηση αποθηκεύει termsVersion + termsAcceptedAt", async () => {
  const created = [];
  const tx = {
    customer: { findFirst: async () => null, create: async () => ({ id: "c1" }) },
    booking: { findUnique: async () => null, create: async (args) => (created.push(args), { id: "b1" }) },
    notification: { create: async () => null },
  };
  const plan = {
    vehicleId: "v1",
    rentalGroupId: "g1",
    stored: { version: 1 },
    breakdown: { dailyRate: 30, totalDays: 3, subtotal: 90, extrasTotal: 0, insuranceCost: 0, discountAmount: 0, total: 90, lines: [] },
  };
  const base = {
    tenantId: "A",
    plan,
    contact: { firstName: "Νίκος", lastName: "Π", email: "n@example.com", phone: "+30 69", birthDate: "1990-01-01", flightNumber: null, notes: null },
    locations: { pickup: "Χανιά", dropoff: null },
    window: { from: "2026-11-01T10:00", to: "2026-11-04T10:00" },
    lang: "el",
  };
  const at = new Date("2026-10-21T08:00:00Z");
  const deps = { nextNumber: async () => "BP-2026-001", generateCode: () => "K7M2-X9PQ" };
  await writeSiteBooking(tx, { ...base, terms: { version: "terms/el/v2", acceptedAt: at } }, deps);
  assert.equal(created[0].data.termsVersion, "terms/el/v2");
  assert.equal(created[0].data.termsAcceptedAt, at);
  await writeSiteBooking(tx, base, deps);
  assert.equal("termsVersion" in created[1].data, false, "χωρίς όρους (π.χ. παλιός κώδικας) → τίποτα");
  // Η υποβολή παίρνει την έκδοση που ισχύει ΤΩΡΑ για τη ΓΛΩΣΣΑ του site και την ΕΤΑΙΡΙΑ του slug.
  const sub = src("src/lib/public/bookingSubmit.ts");
  assert.match(sub, /const termsVersion = await currentTermsVersion\(resolved\.companyId, input\.lang\);/);
  assert.match(sub, /\{ version: termsVersion, acceptedAt: now \}/);
  assert.match(src("src/lib/legal/legalServer.ts"), /export async function currentTermsVersion\(companyId: string, lang: string\)[\s\S]*?latestRows\(companyId, "terms", legalLang\(lang\)\)/);
  // Σχήμα: στήλες + SQL 31.
  const schema = src("prisma/schema.prisma");
  assert.match(schema, /termsVersion\s+String\?/);
  assert.match(schema, /termsAcceptedAt DateTime\?/);
  const sql = src("prisma/sql/31-legal-seo.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "termsVersion" TEXT/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "site_legal_texts"/);
});

test("versionId: πρότυπο vs δική τους έκδοση — σταθερή, αναγνώσιμη μορφή", () => {
  assert.equal(legal.templateVersionId("terms", "el"), `terms/el/template-${TEMPLATE_VERSION}`);
  assert.equal(legal.customVersionId("terms", "en", 3), "terms/en/v3");
  const d = legal.resolveLegalDoc("A", [row("A", "terms", "en", 3, "# T\n\nx".repeat(3), "2026-10-19")], "terms", "en", A);
  assert.equal(d.updated, "2026-10-19");
  assert.equal(legal.formatLegalDate("2026-10-19", "el"), "19/10/2026");
  assert.equal(legal.formatLegalDate("2026-10-19", "en"), "19 Oct 2026");
});

test("φόρμα κράτησης: το τικ των όρων ανοίγει τους όρους/απόρρητο της ΙΔΙΑΣ εταιρίας", () => {
  const views = src("src/components/storefront/StorefrontViews.tsx");
  assert.match(views, /legal=\{\{ termsHref: storefrontPath\(company\.slug, lang, "terms"\), privacyHref: storefrontPath\(company\.slug, lang, "privacy"\) \}\}/);
  const form = src("src/components/storefront/BookingForm.tsx");
  assert.match(form, /href=\{legal\.termsHref\} target="_blank"/);
  assert.match(form, /href=\{legal\.privacyHref\} target="_blank"/);
  // Footer: σε ΚΑΘΕ σελίδα (Shell).
  assert.match(views, /LEGAL_LINKS\.map\(\(\[kind, key\]\) => \(\s*<Link key=\{kind\} href=\{storefrontPath\(company\.slug, lang, kind\)\}/);
});

/* ─────────────────────────────────────────────
   «Νομικά» στο dashboard — δικαιώματα
   ───────────────────────────────────────────── */

test("καρτέλα «Νομικά»: GET/PUT μόνο Admin με publicSite (storefrontAccess) + settings.edit, στον server", () => {
  const r = src("src/app/api/public-site/legal/route.ts");
  for (const m of ["GET", "PUT"]) {
    const body = r.slice(r.indexOf(`export const ${m} = withPermission(`)).split("\n}, ")[0];
    assert.match(body, /const access = await storefrontAccess\(viewer\);\s*if \(!access\.ok\) return forbidden\(access\.message\);/, m);
  }
  assert.equal((r.match(/\}, "settings\.edit"\);/g) ?? []).length, 2);
  // Η εταιρία ΜΟΝΟ από τη συνεδρία.
  assert.match(r, /saveLegalText\(access\.companyId, kind, lang, body, session\.userId\)/);
  assert.doesNotMatch(r, /companyId: (body|parsed)|tenantId/);
  // Ο κανόνας του storefrontAccess: μόνο COMPANY_ADMIN και publicSite.
  const admin = src("src/lib/storefront/admin.ts");
  assert.match(admin, /viewer\.role !== "COMPANY_ADMIN"/);
  assert.match(admin, /hasModule\(viewer\.tenantId, "publicSite"\)/);
  // Η σελίδα «Η σελίδα μου» δεν ανοίγει σε μη Admin.
  assert.match(src("src/app/(dashboard)/dashboard/storefront/page.tsx"), /guard\.viewer\.role !== "COMPANY_ADMIN"\) redirect/);
  assert.match(src("src/app/(dashboard)/dashboard/storefront/StorefrontTabs.tsx"), /tab === "legal" && <LegalTab \/>/);
});

test("αποθήκευση νομικών: έλεγχος σώματος (είδος, γλώσσα, μέγεθος)", () => {
  const ok = legal.legalSaveSchema.safeParse({ kind: "terms", lang: "el", body: "# Όροι\n\nΚείμενο αρκετά μεγάλο." });
  assert.equal(ok.success, true);
  assert.equal(legal.legalSaveSchema.safeParse({ kind: "other", lang: "el", body: "x".repeat(50) }).success, false);
  assert.equal(legal.legalSaveSchema.safeParse({ kind: "terms", lang: "fr", body: "x".repeat(50) }).success, false);
  assert.equal(legal.legalSaveSchema.safeParse({ kind: "terms", lang: "el", body: "   " }).success, false);
  assert.equal(legal.legalSaveSchema.safeParse({ kind: "terms", lang: "el", body: "x".repeat(30001) }).success, false);
  assert.equal(legal.normalizeLegalBody("a  \r\nb\t\r\n\r\n"), "a\nb\n");
});

/* ─────────────────────────────────────────────
   Markdown χωρίς raw HTML (XSS)
   ───────────────────────────────────────────── */

test("markdown: <script>/HTML μένει κείμενο· links μόνο https/mailto/tel", () => {
  const blocks = parseMarkdown('# Τίτλος\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n- **έντονο** και [link](https://example.com)\n- [κακό](javascript:alert(1)) [data](data:text/html,x) [http](http://x.example)\n\n1. ένα\n2. δύο');
  assert.equal(blocks[0].t, "h");
  assert.deepEqual(blocks[1], { t: "p", c: [{ t: "text", v: "<script>alert(1)</script> <img src=x onerror=alert(1)>" }] });
  assert.equal(blocks[2].t, "ul");
  assert.deepEqual(blocks[2].items[0], [{ t: "strong", v: "έντονο" }, { t: "text", v: " και " }, { t: "link", v: "link", href: "https://example.com" }]);
  assert.ok(blocks[2].items[1].every((x) => x.t === "text"), "javascript:/data:/http: → απλό κείμενο");
  assert.equal(blocks[3].t, "ol");
  assert.equal(safeHref("mailto:a@b.gr"), "mailto:a@b.gr");
  assert.equal(safeHref("tel:+30 2821 000000"), "tel:+30 2821 000000");
  assert.equal(safeHref("JavaScript:alert(1)"), null);
  assert.deepEqual(parseInline("γραμμή"), [{ t: "text", v: "γραμμή" }]);
  assert.equal(plainText(parseMarkdown("# A\n\nB **C**")), "A B C");
  // Κανένα raw HTML στην απόδοση.
  assert.doesNotMatch(code("src/components/storefront/LegalText.tsx"), /dangerouslySetInnerHTML|innerHTML/);
});

test("τα πρότυπα είναι έγκυρο markdown χωρίς HTML", () => {
  for (const [kind, byLang] of Object.entries(LEGAL_TEMPLATES)) {
    for (const [lang, body] of Object.entries(byLang)) {
      assert.doesNotMatch(body, /<[a-z]/i, `${kind}/${lang}`);
      const blocks = parseMarkdown(body);
      assert.equal(blocks[0].t, "h", `${kind}/${lang}: ξεκινά με τίτλο`);
      assert.ok(blocks.length > 5);
    }
  }
});
