// tests/contract-link.test.mjs
// Link πελάτη (/c/[token]) — src/lib/contractLink.ts (χωρίς runtime imports).
// Τρέχει με `npm test` (node:test).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINK_DAYS_AFTER_RETURN,
  PUBLIC_TOKEN_RE,
  appBaseUrl,
  linkExpiresAt,
  linkStateOf,
  newPublicToken,
  publicContractUrl,
  publicLinkDTO,
  toPublicContract,
} from "../src/lib/contractLink.ts";

/* ── Δημιουργία token ── */

test("token: 32 bytes base64url (43 χαρακτήρες), χωρίς + / =", () => {
  const t = newPublicToken();
  assert.equal(t.length, 43);
  assert.match(t, PUBLIC_TOKEN_RE);
  assert.doesNotMatch(t, /[+/=]/);
});

test("token: κάθε φορά διαφορετικό", () => {
  const set = new Set(Array.from({ length: 500 }, newPublicToken));
  assert.equal(set.size, 500);
});

test("token: ό,τι δεν είναι 43 base64url χαρακτήρες απορρίπτεται", () => {
  for (const bad of ["", "abc", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}/`, `${"a".repeat(42)}.`]) {
    assert.doesNotMatch(bad, PUBLIC_TOKEN_RE);
  }
});

/* ── Κατάσταση: ενεργό / ακυρωμένο / ληγμένο ── */

const base = { publicToken: "x".repeat(43), publicTokenRevokedAt: null, returnDate: "2026-10-10" };

test("χωρίς token → none", () => {
  assert.equal(linkStateOf({ ...base, publicToken: null }), "none");
});

test("ενεργό πριν τη λήξη, και όλη την 90ή ημέρα", () => {
  assert.equal(linkStateOf(base, new Date("2026-10-04T10:00:00Z")), "active");
  // 2026-10-10 + 90 ημέρες = 2027-01-08
  assert.equal(linkStateOf(base, new Date("2027-01-08T23:59:59Z")), "active");
});

test("ληγμένο από την 91η ημέρα μετά την επιστροφή", () => {
  assert.equal(linkExpiresAt("2026-10-10").toISOString(), "2027-01-09T00:00:00.000Z");
  assert.equal(linkStateOf(base, new Date("2027-01-09T00:00:00Z")), "expired");
  assert.equal(LINK_DAYS_AFTER_RETURN, 90);
});

test("ακυρωμένο → revoked (και πριν τη λήξη)", () => {
  assert.equal(
    linkStateOf({ ...base, publicTokenRevokedAt: new Date("2026-10-05") }, new Date("2026-10-06")),
    "revoked"
  );
});

test("άκυρη ημερομηνία επιστροφής → θεωρείται ληγμένο (ποτέ ανοιχτό)", () => {
  assert.equal(linkStateOf({ ...base, returnDate: "" }), "expired");
});

test("ακυρωμένο ή ληγμένο → η φόρμα ΔΕΝ παίρνει το token", () => {
  assert.equal(publicLinkDTO({ ...base, publicTokenRevokedAt: new Date() }).token, null);
  assert.equal(publicLinkDTO(base, new Date("2027-02-01")).token, null);
  assert.equal(publicLinkDTO(base, new Date("2026-10-04")).token, base.publicToken);
});

test("νέο link: διαφορετικό token, άρα το παλιό δεν βρίσκεται πια", () => {
  const a = newPublicToken();
  const b = newPublicToken();
  assert.notEqual(a, b);
});

/* ── URL ── */

test("βασικό URL: NEXT_PUBLIC_APP_URL αλλιώς host του αιτήματος", () => {
  assert.equal(appBaseUrl("https://app.example.com/", "http://localhost:3000"), "https://app.example.com");
  assert.equal(appBaseUrl("", "https://fleet.vercel.app"), "https://fleet.vercel.app");
  assert.equal(appBaseUrl("  ", "https://h.example/"), "https://h.example");
  assert.equal(publicContractUrl("https://a.b/", "TOKEN"), "https://a.b/c/TOKEN");
});

/* ── Η δημόσια σελίδα: χωρίς διπλώματα, χωρίς εσωτερικά ids ── */

const SECRET = {
  contractId: "ckcontract123456789",
  bookingId: "ckbooking987654321",
  vehicleId: "ckvehicle55555",
  changeVehicleId: "ckvehicle77777",
  driverId: "a1b2c3d4e5f60718",
  photoId: "PhOtOrAnDoM123456",
  licensePath: "tenantX/ckcontract123456789/licenses/a1b2c3d4e5f60718-front-RaNd0m.jpg",
};

const dto = {
  id: SECRET.contractId,
  contractNumber: "C-ABCDEF",
  status: "SIGNED",
  bookingId: SECRET.bookingId,
  bookingNumber: "BK-0042",
  bookingStatus: "ACTIVE",
  createdByName: "Υπάλληλος Γραφείου",
  snapshot: {
    company: { name: "Εταιρία", region: "", vat: "", taxOffice: "", phone: "", email: "", address: "", logoUrl: "https://old/logo.png" },
    booking: {
      number: "BK-0042", pickupDate: "2026-10-01", pickupTime: "10:00", returnDate: "2026-10-05",
      returnTime: "10:00", totalDays: 4, dailyRate: 40, subtotal: 160, extrasTotal: 0,
      insuranceCost: 0, discountAmount: 0, discountCode: null, total: 160,
    },
    vehicle: { id: SECRET.vehicleId, brand: "Fiat", model: "Panda", plate: "ΙΚΑ-1234", fuel: "PETROL" },
    extras: [], insurance: [], terms: { el: "όροι", en: "terms" }, vatRate: 24, takenAt: "2026-10-01T00:00:00Z",
  },
  drivers: [
    {
      id: SECRET.driverId, fullName: "Γιάννης Π.", country: "GR", licenseNumber: "123", licenseExpiry: "",
      birthDate: "", idType: "ID", idNumber: "AB1", phone: "", email: "", address: "",
      signature: "data:image/png;base64,AAAA", signedAt: "2026-10-01T10:00:00Z",
      licensePhotos: { front: SECRET.licensePath },
    },
  ],
  pickupLocation: "Αεροδρόμιο", returnLocation: "Αεροδρόμιο", fuelPickup: 8, fuelReturn: 4,
  damageMarks: [],
  damagePhotos: [{ id: SECRET.photoId, group: "PICKUP", url: "https://signed/x", takenAt: null, note: "γρατζουνιά" }],
  damageNotesPickup: "", damageNotesReturn: "",
  vehicleChanges: [{ id: "chg1234567", vehicleId: SECRET.changeVehicleId, label: "Fiat 500", plate: "ΧΧΧ-1", date: "2026-10-02" }],
  notes: "ΕΣΩΤΕΡΙΚΗ σημείωση",
  paymentMethod: "CARD", depositAmount: 300, depositMethod: "CARD_HOLD",
  paymentCard: { brand: "VISA", last4: "4242", holder: "X", expiry: "08/27" },
  depositCard: { brand: "VISA", last4: "4242", holder: "X", expiry: "08/27" },
  gdprConsent: true, signedAt: "2026-10-01T10:00:00Z", completedAt: null,
  createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-01T10:00:00Z",
  bookingExtraIds: ["ckextra1"], bookingTotalNow: 160, extrasLock: "signed",
  licensePhotos: [{ driverId: SECRET.driverId, side: "front", id: "x-front-RaNd0m", url: "https://signed/license" }],
  publicLink: { state: "active", token: "T".repeat(43), expiresAt: "2027-01-04T00:00:00Z" },
};

test("δημόσια δεδομένα: ΚΑΜΙΑ διαδρομή/URL διπλώματος", () => {
  const json = JSON.stringify(toPublicContract(dto));
  assert.doesNotMatch(json, /licenses\//);
  assert.doesNotMatch(json, /licensePhotos"\s*:\s*\[\s*\{/);
  assert.doesNotMatch(json, /signed\/license/);
  assert.doesNotMatch(json, /RaNd0m/);
});

test("δημόσια δεδομένα: ΚΑΝΕΝΑ εσωτερικό id", () => {
  const json = JSON.stringify(toPublicContract(dto));
  for (const [name, id] of Object.entries(SECRET)) {
    assert.ok(!json.includes(id), `διαρρέει ${name}`);
  }
  assert.ok(!json.includes("ckextra1"));
});

test("δημόσια δεδομένα: χωρίς πληρωμή/κάρτα/εγγύηση, σημειώσεις, κράτηση, token", () => {
  const p = toPublicContract(dto);
  assert.equal(p.paymentCard, null);
  assert.equal(p.depositCard, null);
  assert.equal(p.paymentMethod, null);
  assert.equal(p.depositAmount, null);
  assert.equal(p.notes, "");
  assert.equal(p.bookingNumber, "");
  assert.equal(p.snapshot.booking.number, "");
  assert.equal(p.createdByName, null);
  assert.equal(p.publicLink.token, null);
  assert.equal(p.snapshot.company.logoUrl, null);
  const json = JSON.stringify(p);
  assert.ok(!json.includes("4242"));
  assert.ok(!json.includes("ΕΣΩΤΕΡΙΚΗ"));
  assert.ok(!json.includes("T".repeat(43)));
});

test("δημόσια δεδομένα: ό,τι χρειάζεται ο πελάτης μένει", () => {
  const p = toPublicContract(dto);
  assert.equal(p.contractNumber, "C-ABCDEF");
  assert.equal(p.drivers[0].fullName, "Γιάννης Π.");
  assert.equal(p.drivers[0].signature, "data:image/png;base64,AAAA");
  assert.equal(p.damagePhotos[0].url, "https://signed/x");
  assert.equal(p.vehicleChanges[0].plate, "ΧΧΧ-1");
  assert.equal(p.fuelPickup, 8);
  assert.equal(p.snapshot.terms.en, "terms");
});
