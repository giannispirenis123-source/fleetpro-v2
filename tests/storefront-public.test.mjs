// tests/storefront-public.test.mjs
// Η δημόσια σελίδα ΔΕΝ διαρρέει ιδιωτικά πεδία: src/lib/storefront/publicData.ts,
// settings.ts και i18n.ts. Τρέχει με `npm test`.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

// Τα .ts του src εισάγουν σχετικά αρχεία χωρίς κατάληξη ("./settings").
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { toPublicCompany, toPublicVehicle, safeBrandColor, PUBLIC_VEHICLE_SELECT } = await import(
  "../src/lib/storefront/publicData.ts"
);
const { normalizeStorefrontSettings, pickText, mergeStorefrontSettings, storefrontUpdateSchema } =
  await import("../src/lib/storefront/settings.ts");
const { storefrontDictionary, STOREFRONT_LANGUAGES } = await import("../src/lib/storefront/i18n.ts");

// Μια «πλήρης» εταιρία όπως θα την έδινε ένα απρόσεκτο select *: με IBAN,
// ΑΦΜ, Stripe, όρια, πελάτες, κρατήσεις, συμβόλαια, τιμολόγια.
const FULL_TENANT = {
  id: "tenant_secret_id",
  slug: "p-rentals",
  storefrontSlug: "chania-cars",
  name: "Chania Cars",
  email: "info@chania.example",
  phone: "+30 28210 00000",
  address: "Οδός 1",
  region: "Χανιά",
  vat: "999999999",
  taxOffice: "Χανίων",
  iban: "GR1601101250000000012300695",
  brandColor: "#0EA5E9",
  logoPath: "tenant_secret_id/branding/logo-x.png",
  stripeCustomerId: "cus_secret",
  stripeSubId: "sub_secret",
  contractTermsEl: "όροι",
  planKey: "full",
  entitlementOverrides: { limits: { maxUsers: 99 } },
  storefrontEnabled: true,
  storefrontSettings: {
    title: { el: "Καλώς ήρθατε", en: "Welcome" },
    theme: { heroImage: { url: "https://res.cloudinary.com/demo/image/upload/v1/hero.jpg", publicId: "fleetpro/tenant_secret_id/site/hero" } },
  },
  customers: [{ id: "c1", email: "client@example.com", phone: "6900000000" }],
  bookings: [{ id: "b1", total: 100 }],
  contracts: [{ id: "k1", cardNumberEnc: "enc", publicToken: "tok" }],
  invoices: [{ id: "i1", invoiceCode: "K7M2-X9PQ" }],
};

const FULL_VEHICLE = {
  id: "veh1",
  tenantId: "tenant_secret_id",
  brand: "Fiat",
  model: "Panda",
  plate: "ΧΝΑ-1234",
  year: 2022,
  color: "white",
  category: "A",
  dailyRate: { toString: () => "35.5", valueOf: () => 35.5 },
  status: "AVAILABLE",
  km: 41234,
  fuel: "PETROL",
  seats: 4,
  doors: 5,
  transmission: "Manual",
  ac: true,
  nextServiceKm: 50000,
  insuranceExpiry: new Date("2027-01-01"),
  kteoExpiry: new Date("2027-01-01"),
  notes: "εσωτερική σημείωση",
  images: ["https://old.example/x.jpg"],
  photos: [
    { id: "p2", url: "https://res.cloudinary.com/demo/image/upload/v1/b.jpg", publicId: "fleetpro/tenant_secret_id/vehicles/veh1/b", order: 1 },
    { id: "p1", url: "https://res.cloudinary.com/demo/image/upload/v1/a.jpg", publicId: "fleetpro/tenant_secret_id/vehicles/veh1/a", order: 0 },
  ],
  isActive: true,
  publicVisible: true,
  bookings: [{ id: "b1" }],
};

const PRIVATE_TEXT = [
  "tenant_secret_id", "GR1601101250000000012300695", "999999999", "cus_secret", "sub_secret",
  "client@example.com", "6900000000", "K7M2-X9PQ", "ΧΝΑ-1234", "41234", "εσωτερική σημείωση",
  "publicId", "logoPath", "p-rentals", "planKey", "entitlementOverrides", "maxUsers", "enc", "tok",
];

test("εταιρία: μόνο τα επιτρεπόμενα πεδία", () => {
  const pub = toPublicCompany(FULL_TENANT, "https://signed.example/logo.png");
  assert.deepEqual(
    Object.keys(pub).sort(),
    ["address", "basePath", "brandColor", "email", "loginUrl", "logoUrl", "name", "phone", "region", "rentalMode", "settings", "siteDomain", "slug"]
  );
  assert.equal(pub.slug, "chania-cars", "το δημόσιο slug, όχι το εσωτερικό");
  // Domain: μόνο όταν είναι VERIFIED· links με /s/<slug> εκτός αν σερβίρεται στο domain.
  assert.equal(pub.siteDomain, null);
  assert.equal(pub.basePath, "/s/chania-cars");
  assert.equal(pub.loginUrl, "/login");
  const pending = toPublicCompany({ ...FULL_TENANT, customDomain: "www.chania-cars.gr", customDomainStatus: "PENDING" }, null);
  assert.equal(pending.siteDomain, null, "PENDING δεν μετρά");
  const onDomain = toPublicCompany(
    { ...FULL_TENANT, customDomain: "www.chania-cars.gr", customDomainStatus: "VERIFIED" },
    null,
    { onDomain: true, platformOrigin: "https://fleetpro-app-eight.vercel.app" }
  );
  assert.equal(onDomain.siteDomain, "www.chania-cars.gr");
  assert.equal(onDomain.basePath, "");
  assert.equal(onDomain.loginUrl, "https://fleetpro-app-eight.vercel.app/login");
  assert.equal(toPublicCompany(FULL_TENANT, null, { onDomain: true, platformOrigin: null }).loginUrl, null);
  const json = JSON.stringify(pub);
  for (const secret of PRIVATE_TEXT) {
    if (secret === "enc") continue; // κοινή συλλαβή, ελέγχεται με τα tokens πιο κάτω
    assert.ok(!json.includes(secret), `διαρροή: ${secret}`);
  }
});

test("όχημα: όχι πινακίδα, χιλιόμετρα, σημειώσεις, tenantId, publicId", () => {
  const pub = toPublicVehicle(FULL_VEHICLE);
  assert.deepEqual(
    Object.keys(pub).sort(),
    ["ac", "brand", "category", "dailyRate", "doors", "fuel", "id", "model", "photos", "seats", "transmission", "year"]
  );
  assert.equal(pub.dailyRate, 35.5);
  assert.deepEqual(pub.photos, [
    "https://res.cloudinary.com/demo/image/upload/v1/a.jpg",
    "https://res.cloudinary.com/demo/image/upload/v1/b.jpg",
  ], "μόνο URLs, η κύρια πρώτη");
  const json = JSON.stringify(pub);
  for (const secret of ["tenant_secret_id", "ΧΝΑ-1234", "41234", "εσωτερική σημείωση", "publicId", "old.example"]) {
    assert.ok(!json.includes(secret), `διαρροή: ${secret}`);
  }
});

test("το select της βάσης για οχήματα δεν ζητά ιδιωτικά πεδία", () => {
  const keys = Object.keys(PUBLIC_VEHICLE_SELECT);
  for (const k of ["plate", "km", "notes", "tenantId", "bookings", "insuranceExpiry", "kteoExpiry", "images"]) {
    assert.ok(!keys.includes(k), k);
  }
});

test("brand color: μόνο #RRGGBB περνά σε CSS", () => {
  assert.equal(safeBrandColor("#0EA5E9"), "#0EA5E9");
  for (const bad of ["red", "#fff", "#0EA5E9;background:url(x)", "url(javascript:1)", null, 42]) {
    assert.equal(safeBrandColor(bad), "#2563EB", String(bad));
  }
});

test("ρυθμίσεις: προεπιλογές από κενό/χαλασμένο JSON", () => {
  for (const raw of [null, {}, "x", [], { supportedLanguages: ["xx"], defaultLanguage: "zz" }]) {
    const s = normalizeStorefrontSettings(raw);
    assert.deepEqual(s.supportedLanguages, ["el", "en"]);
    assert.equal(s.defaultLanguage, "el");
    assert.deepEqual(s.paymentOptions, { onPickup: true, online: false });
    assert.equal("bookingMode" in s, false, "ο τρόπος κράτησης ζει μόνο στο rentalMode");
    assert.equal(s.booking.graceMinutes, 59);
    assert.equal(s.booking.timezone, "Europe/Athens");
    assert.equal(s.theme.cornerStyle, "pill");
    assert.deepEqual(s.trustBlocks, []);
  }
});

test("ρυθμίσεις: online πληρωμή μένει κλειστή («σύντομα»)", () => {
  const s = normalizeStorefrontSettings({ paymentOptions: { onPickup: false, online: true } });
  assert.deepEqual(s.paymentOptions, { onPickup: false, online: false });
});

test("ρυθμίσεις: κείμενα μόνο σε γνωστές γλώσσες, χωρίς άγνωστα κλειδιά", () => {
  const s = normalizeStorefrontSettings({
    title: { el: " Γεια ", en: "Hi", xx: "?" , fr: 5 },
    iban: "GR16…",
    secret: "x",
  });
  assert.deepEqual(s.title, { el: "Γεια", en: "Hi" });
  assert.ok(!("iban" in s) && !("secret" in s));
});

test("ρυθμίσεις: η προεπιλεγμένη γλώσσα είναι πάντα από τις υποστηριζόμενες", () => {
  const s = normalizeStorefrontSettings({ supportedLanguages: ["en"], defaultLanguage: "el" });
  assert.deepEqual(s.supportedLanguages, ["en"]);
  assert.equal(s.defaultLanguage, "en");
});

test("pickText: γλώσσα → προεπιλογή → κενό", () => {
  const t = { el: "Ελληνικά", en: "English" };
  assert.equal(pickText(t, "en", "el"), "English");
  assert.equal(pickText({ el: "Μόνο ΕΛ" }, "en", "el"), "Μόνο ΕΛ");
  assert.equal(pickText({}, "en", "el"), "");
});

test("PATCH «Η σελίδα μου»: άγνωστη γλώσσα απορρίπτεται, πεδία εταιρίας δεν υπάρχουν στο σχήμα", () => {
  assert.equal(storefrontUpdateSchema.safeParse({ supportedLanguages: ["el", "xx"] }).success, false);
  const parsed = storefrontUpdateSchema.parse({ enabled: true, iban: "GR…", tenantId: "other", companyId: "other" });
  assert.ok(!("iban" in parsed) && !("tenantId" in parsed) && !("companyId" in parsed));
  const merged = mergeStorefrontSettings(normalizeStorefrontSettings({}), { payOnPickup: false, title: { en: "New" } });
  assert.equal(merged.paymentOptions.onPickup, false);
  assert.deepEqual(merged.title, { en: "New" });
});

test("i18n: κάθε γλώσσα έχει ΟΛΑ τα κλειδιά (fallback στα αγγλικά)", () => {
  assert.ok(STOREFRONT_LANGUAGES.includes("el") && STOREFRONT_LANGUAGES.includes("en"));
  const en = storefrontDictionary("en");
  for (const lang of [...STOREFRONT_LANGUAGES, "fr"]) {
    const d = storefrontDictionary(lang);
    for (const key of Object.keys(en)) assert.ok(d[key] !== undefined, `${lang}.${key}`);
    for (const c of Object.keys(en.categories)) assert.ok(d.categories[c], `${lang}.categories.${c}`);
  }
  assert.equal(storefrontDictionary("fr").ourFleet, "Our fleet", "άγνωστη γλώσσα → αγγλικά");
  assert.equal(storefrontDictionary("el").ourFleet, "Ο στόλος μας");
});
