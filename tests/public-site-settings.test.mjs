// tests/public-site-settings.test.mjs
// Ρυθμίσεις δημόσιου site (src/lib/public/siteSettings.ts, storefront/settings.ts)
// και κλίμακες τιμών (src/lib/public/rates.ts). Τρέχει με `npm test`.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { normalizeStorefrontSettings, mergeSiteSettings, mergeStorefrontSettings } = await import("../src/lib/storefront/settings.ts");
const { siteSettingsUpdateSchema, DEFAULT_BOOKING, readTrustBlocks } = await import("../src/lib/public/siteSettings.ts");
const { tiersProblem } = await import("../src/lib/public/rates.ts");
const { textFor } = await import("../src/lib/public/text.ts");

test("προεπιλογές κρατήσεων όπως στο σχέδιο", () => {
  const s = normalizeStorefrontSettings({});
  assert.deepEqual(s.booking, DEFAULT_BOOKING);
  assert.equal(s.booking.holdHours, 24);
  assert.equal(s.booking.minLeadHours, 3);
  assert.equal(s.booking.defaultPickupTime, "10:00");
  assert.equal(s.booking.timezone, "Europe/Athens");
  assert.equal(s.theme.cornerStyle, "pill");
  assert.deepEqual(s.contact.phone, "");
});

test("το παλιό bookingMode αγνοείται — ο τρόπος κράτησης ζει στο rentalMode", () => {
  const s = normalizeStorefrontSettings({ bookingMode: "request" });
  assert.equal("bookingMode" in s, false);
  const parsed = siteSettingsUpdateSchema.parse({ rentalMode: "BOOKING", bookingMode: "instant" });
  assert.equal(parsed.rentalMode, "BOOKING");
  assert.equal("bookingMode" in parsed, false);
  const merged = mergeSiteSettings(normalizeStorefrontSettings({}), parsed);
  assert.equal("rentalMode" in merged, false, "δεν γράφεται στο JSON");
});

test("ΦΠΑ δεν υπάρχει στις ρυθμίσεις του site (μένει στο tenants.vatRate)", () => {
  const parsed = siteSettingsUpdateSchema.parse({ booking: { vatPercent: 13 } });
  assert.equal("vatPercent" in (parsed.booking ?? {}), false);
});

test("merge ανά ενότητα: κρατά τα υπόλοιπα και ΔΕΝ πειράζει το heroImage", () => {
  const current = normalizeStorefrontSettings({
    title: { el: "Τίτλος" },
    theme: { heroImage: { url: "https://res.cloudinary.com/x/image/upload/v1/a.jpg", publicId: "fleetpro/t/site/a" } },
    booking: { holdHours: 12 },
  });
  const next = mergeSiteSettings(current, siteSettingsUpdateSchema.parse({ booking: { graceMinutes: 30 }, theme: { cornerStyle: "rounded" } }));
  assert.equal(next.booking.holdHours, 12);
  assert.equal(next.booking.graceMinutes, 30);
  assert.equal(next.theme.cornerStyle, "rounded");
  assert.equal(next.theme.heroImage.publicId, "fleetpro/t/site/a");
  assert.deepEqual(next.title, { el: "Τίτλος" });
  // Και η αποθήκευση από την καρτέλα «Σελίδα» δεν σβήνει τις νέες ενότητες.
  const page = mergeStorefrontSettings(next, { title: { el: "Νέος" } });
  assert.equal(page.booking.holdHours, 12);
  assert.equal(page.theme.cornerStyle, "rounded");
});

test("άκυρες τιμές → προεπιλογές (το site δεν σπάει από χαλασμένο JSON)", () => {
  const s = normalizeStorefrontSettings({
    booking: { holdHours: -5, defaultPickupTime: "25:00", timezone: "Mars/Base", oneWayFeeCents: "x" },
    contact: { mapUrl: "javascript:alert(1)" },
    theme: { accentColor: "red", cornerStyle: "square" },
  });
  assert.equal(s.booking.holdHours, 24);
  assert.equal(s.booking.defaultPickupTime, "10:00");
  assert.equal(s.booking.timezone, "Europe/Athens");
  assert.equal(s.booking.oneWayFeeCents, null);
  assert.equal(s.contact.mapUrl, "");
  assert.equal(s.theme.accentColor, null);
  assert.equal(s.theme.cornerStyle, "pill");
});

test("zod: ελληνικά μηνύματα, όριο 6 ενοτήτων, μόνο γνωστά εικονίδια", () => {
  const bad = siteSettingsUpdateSchema.safeParse({ contact: { email: "όχι-email" } });
  assert.equal(bad.success, false);
  assert.equal(bad.error.errors[0].message, "Μη έγκυρο email");
  const block = { icon: "ShieldCheck", title: { el: "Α" }, text: {} };
  assert.equal(siteSettingsUpdateSchema.safeParse({ trustBlocks: Array(7).fill(block) }).success, false);
  assert.equal(siteSettingsUpdateSchema.safeParse({ trustBlocks: [{ ...block, icon: "Skull" }] }).success, false);
  assert.equal(readTrustBlocks(Array(9).fill(block)).length, 6);
});

test("κείμενα: ζητούμενη → en → el → πρώτη", () => {
  assert.equal(textFor({ el: "Γεια", en: "Hi" }, "en"), "Hi");
  assert.equal(textFor({ el: "Γεια", en: "Hi" }, "fr"), "Hi");
  assert.equal(textFor({ el: "Γεια" }, "fr"), "Γεια");
  assert.equal(textFor({ pl: "Cześć" }, "fr"), "Cześć");
  assert.equal(textFor(null, "el"), "");
});

test("κλίμακες: έγκυρες / επικάλυψη / κενό «έως» μόνο στην τελευταία / τιμή > 0", () => {
  const ok = [
    { minDays: 1, maxDays: 3, dailyPriceCents: 3500 },
    { minDays: 4, maxDays: 6, dailyPriceCents: 3000 },
    { minDays: 7, maxDays: null, dailyPriceCents: 2600 },
  ];
  assert.equal(tiersProblem(ok), null);
  assert.equal(tiersProblem([]), null);
  assert.match(tiersProblem([{ minDays: 1, maxDays: 5, dailyPriceCents: 1 }, { minDays: 4, maxDays: null, dailyPriceCents: 1 }]), /επικαλύπτονται/);
  assert.match(tiersProblem([{ minDays: 1, maxDays: null, dailyPriceCents: 1 }, { minDays: 4, maxDays: null, dailyPriceCents: 1 }]), /τελευταία/);
  assert.match(tiersProblem([{ minDays: 3, maxDays: 2, dailyPriceCents: 1 }]), /≥/);
  assert.match(tiersProblem([{ minDays: 1, maxDays: null, dailyPriceCents: 0 }]), /πάνω από 0/);
  assert.match(tiersProblem([{ minDays: 0, maxDays: null, dailyPriceCents: 10 }]), /από 1/);
});
