// tests/partner-discounts.test.mjs — κωδικοί έκπτωσης ΑΝΑΤΕΘΕΙΜΕΝΟΙ σε συνεργάτη
// (SQL 40): τους φτιάχνει ΜΟΝΟ η εταιρία· έκπτωση ως την προμήθεια του
// συνεργάτη (ίση επιτρέπεται), μόνο ποσοστό, ίδια εταιρία, ενεργός· ο συνεργάτης
// 403 σε δημιουργία/αλλαγή/απενεργοποίηση και βλέπει ΜΟΝΟ τους δικούς του. SQL 39/40.

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

const C = await import("../src/lib/commission.ts");
const P = await import("../src/lib/permissions.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const S20 = { rate: 20, onRental: true, onExtras: false, onInsurance: false };

test("όριο: έκπτωση ≤ προμήθεια (ίση επιτρέπεται), πάνω → απόρριψη· σταθερό ποσό → απόρριψη", () => {
  assert.equal(C.maxPartnerDiscountPercent(S20), 20);
  assert.deepEqual(C.checkPartnerDiscount("PERCENTAGE", 30, S20), { ok: false, reason: "over_commission", max: 20 });
  assert.deepEqual(C.checkPartnerDiscount("PERCENTAGE", 20.01, S20), { ok: false, reason: "over_commission", max: 20 });
  assert.deepEqual(C.checkPartnerDiscount("PERCENTAGE", 20, S20), { ok: true });
  assert.deepEqual(C.checkPartnerDiscount("PERCENTAGE", 5, S20), { ok: true });
  assert.deepEqual(C.checkPartnerDiscount("FIXED_AMOUNT", 1, S20), { ok: false, reason: "fixed_amount" });
  // Χωρίς προμήθεια: κανένας κωδικός (η τιμή είναι πάντα θετική).
  assert.deepEqual(C.checkPartnerDiscount("PERCENTAGE", 1, C.NO_COMMISSION), { ok: false, reason: "over_commission", max: 0 });
  // Το ποσοστό είναι ΤΟ ΙΔΙΟ πεδίο της υπάρχουσας λογικής προμήθειας (CommissionSettings.rate).
  assert.match(read("src/lib/commission.ts"), /export const maxPartnerDiscountPercent = \(s: CommissionSettings\): number => Math\.max\(0, s\.rate\);/);
});

// Το discountAccess.ts εισάγει db: τον καθαρό έλεγχο τον φορτώνουμε μέσω ενός
// ψεύτικου db module (κανένα ερώτημα δεν τρέχει).
const A = await import("../src/lib/discountAccess.ts").catch(() => null);

const partner = (over = {}) => ({ id: "P1", role: "PARTNER", tenantId: "T1", isActive: true, commissionRate: 20, commissionOnRental: true, commissionOnExtras: false, commissionOnInsurance: false, ...over });
const code = (over = {}) => ({ type: "PERCENTAGE", value: 5, target: "ALL", isActive: true, ...over });

test("ανάθεση: 5% σε συνεργάτη 20% → επιτρέπεται· πάνω → 400 με μήνυμα ΕΛ/EN· σε € → απόρριψη· άλλης εταιρίας/ανύπαρκτος → απόρριψη", () => {
  assert.ok(A, "discountAccess.ts φορτώνεται");
  const ok = (d, p, id = "P1") => A.assignmentProblem(d, id, p, "T1");
  assert.equal(ok(code(), partner()), null);
  assert.equal(ok(code({ value: 20 }), partner()), null, "ίσο επιτρέπεται");
  assert.deepEqual(ok(code({ value: 21 }), partner()), A.ASSIGN_MESSAGES.over(20));
  assert.match(A.ASSIGN_MESSAGES.over(20).el, /προμήθεια του συνεργάτη \(20%\)/);
  assert.match(A.ASSIGN_MESSAGES.over(20).en, /partner's commission \(20%\)/);
  assert.deepEqual(ok(code({ type: "FIXED_AMOUNT", value: 10 }), partner()), A.ASSIGN_MESSAGES.percentOnly);
  assert.deepEqual(ok(code({ target: "CUSTOMER" }), partner()), A.ASSIGN_MESSAGES.allOnly);
  assert.deepEqual(ok(code(), partner({ tenantId: "T2" })), A.ASSIGN_MESSAGES.notFound, "άλλης εταιρίας");
  assert.deepEqual(ok(code(), null), A.ASSIGN_MESSAGES.notFound, "ανύπαρκτος = άλλης εταιρίας (ίδια απάντηση)");
  assert.deepEqual(ok(code(), partner({ role: "STAFF" })), A.ASSIGN_MESSAGES.notFound, "όχι συνεργάτης");
  assert.deepEqual(ok(code(), partner({ isActive: false })), A.ASSIGN_MESSAGES.inactive);
  assert.deepEqual(ok(code(), partner({ commissionRate: 0 })), A.ASSIGN_MESSAGES.noCommission);
  // Κωδικός εταιρίας (χωρίς συνεργάτη): ΚΑΝΕΝΑΣ νέος περιορισμός (όπως πριν).
  assert.equal(A.assignmentProblem(code({ type: "FIXED_AMOUNT", value: 50, target: "CUSTOMER" }), null, null, "T1"), null);
  // Ανενεργός κωδικός μπορεί να κρατά συνεργάτη που απενεργοποιήθηκε (ίδια εταιρία).
  assert.equal(ok(code({ isActive: false, value: 50 }), partner({ isActive: false })), null);
});

test("server: POST και PATCH ελέγχουν την ανάθεση (400 στη γλώσσα του χρήστη, τίποτα δεν γράφεται)", () => {
  for (const f of ["src/app/api/discounts/route.ts", "src/app/api/discounts/[id]/route.ts"]) {
    const src = read(f);
    assert.match(src, /assignmentProblem\(/);
    assert.match(src, /loadAssignablePartner\(session\.tenantId!, /, "συνεργάτης ΜΟΝΟ της εταιρίας του session");
    assert.match(src, /if \(assign\) return badRequest\(assign\[await viewerLang\(viewer!\)\]\);/);
    assert.ok(src.indexOf("return badRequest(assign") < src.indexOf(f.includes("[id]") ? "db.discount.update" : "db.discount.create"), "έλεγχος ΠΡΙΝ την εγγραφή");
  }
  assert.match(read("src/app/api/discounts/route.ts"), /createdById: viewer!\.userId,\n\s+partnerId,/);
  assert.match(read("src/lib/discountAccess.ts"), /where: \{ id: partnerId, tenantId, role: "PARTNER" \}/);
});

test("συνεργάτης: 403 σε δημιουργία/επεξεργασία/απενεργοποίηση ακόμα και με δικαιώματα στο JSON", () => {
  const json = { "discounts.view": true, "discounts.create": true, "discounts.edit": true, "discounts.delete": true };
  for (const k of ["discounts.create", "discounts.edit", "discounts.delete"]) {
    assert.ok(P.PARTNER_NEVER.has(k), k);
    assert.equal(P.can("PARTNER", json, k), false, k);
    assert.equal(P.can("STAFF", json, k), true, `προσωπικό με δικαίωμα: ${k}`);
    assert.equal(P.can("COMPANY_ADMIN", {}, k), true);
  }
  assert.equal(P.can("PARTNER", json, "discounts.view"), true, "η προβολή μένει");
  // Δεν φαίνονται στο παράθυρο Δικαιωμάτων / φόρμα του συνεργάτη.
  const keys = P.groupsForRole("PARTNER").flatMap((g) => g.items.map((i) => i.key));
  assert.ok(keys.includes("discounts.view") && !keys.some((k) => /discounts\.(create|edit|delete)/.test(k)));
  // Και ρητός έλεγχος ρόλου στα routes.
  const post = read("src/app/api/discounts/route.ts");
  const one = read("src/app/api/discounts/[id]/route.ts");
  assert.match(post, /if \(viewer!\.role === "PARTNER"\) return forbidden/);
  assert.equal((one.match(/if \(viewer!\.role === "PARTNER"\) return forbidden/g) ?? []).length, 2, "PATCH και DELETE");
});

test("ορατότητα: ο συνεργάτης ΜΟΝΟ όσους του ανατέθηκαν (λίστα, σελίδα, λεπτομέρεια)· οι άλλοι όλους", () => {
  assert.deepEqual(A.discountScope({ role: "PARTNER", userId: "P1", tenantId: "T1", permissions: {} }), { tenantId: "T1", partnerId: "P1" });
  assert.deepEqual(A.discountScope({ role: "STAFF", userId: "S1", tenantId: "T1", permissions: {} }), { tenantId: "T1" });
  assert.deepEqual(A.discountScope({ role: "COMPANY_ADMIN", userId: "A1", tenantId: "T1", permissions: {} }), { tenantId: "T1" });
  assert.match(read("src/app/api/discounts/route.ts"), /\.\.\.discountScope\(viewer!\)/);
  const one = read("src/app/api/discounts/[id]/route.ts");
  assert.equal((one.match(/discountScope\(viewer!\)/g) ?? []).length, 3, "GET, PATCH, DELETE");
  assert.match(one, /export const GET = withPermission/);
  const page = read("src/app/(dashboard)/dashboard/discounts/page.tsx");
  assert.match(page, /where: discountScope\(viewer\)/);
  assert.match(page, /role: "PARTNER", \.\.\.\(isPartner \? \{ id: viewer\.userId \} : \{\}\)/);
  assert.match(page, /create: viewerCan\(viewer, "discounts\.create"\)/);
});

test("φόρμα: «Συνεργάτης» με ενεργούς συνεργάτες και ποσοστό, μέγιστο, μήνυμα ΕΛ/EN, κάρτα", () => {
  const ui = read("src/app/(dashboard)/dashboard/discounts/DiscountsClient.tsx");
  assert.match(ui, /data-testid="discount-partner-select"/);
  assert.match(ui, /\{p\.name\} · \{pctLabel\(p\.rate, locale\)\}/);
  assert.match(ui, /partners\.filter\(\(p\) => p\.isActive \|\| p\.id === discount\?\.partnerId\)/);
  assert.match(ui, /data-testid="discount-max"/);
  assert.match(ui, /data-testid="discount-partner"/);
  const el = read("src/lib/i18n/el.ts");
  const en = read("src/lib/i18n/en.ts");
  assert.match(el, /partnerMax: "Μέγιστη έκπτωση: \{max\} \(η προμήθεια του συνεργάτη\)"/);
  assert.match(en, /partnerMax: "Maximum discount: \{max\} \(the partner's commission\)"/);
  assert.match(el, /cardPartner: "Συνεργάτης: \{name\} \(προμήθεια \{rate\}\)"/);
  assert.match(en, /cardPartner: "Partner: \{name\} \(commission \{rate\}\)"/);
});

test("απενεργοποίηση/αλλαγή ρόλου/διαγραφή συνεργάτη → οι κωδικοί του απενεργοποιούνται", () => {
  assert.match(read("src/lib/discounts.ts"), /where: \{ tenantId, isActive: true, OR: \[\{ partnerId \}, \{ createdById: partnerId \}\] \}/);
  const cu = read("src/app/api/company-users/[id]/route.ts");
  assert.match(cu, /target\.role === "PARTNER" && \(data\.isActive === false \|\| nextRole !== "PARTNER"\)\) \{\s*await deactivatePartnerCodes\(tx, viewer\.tenantId!, target\.id\);/);
  assert.match(cu, /if \(target!\.role === "PARTNER"\) await deactivatePartnerCodes\(tx, viewer\.tenantId!, target!\.id\);/);
  const del = read("src/lib/userDelete.ts");
  assert.match(del, /if \(target\.role === "PARTNER"\) await deactivatePartnerCodes\(tx, tenantId, id\);/);
  assert.ok(del.indexOf("deactivatePartnerCodes(tx") < del.indexOf("tx.user.delete"));
});

test("SQL 39: μόνο προσθήκη (nullable στήλη, FK SET NULL, index), idempotent, με verification", () => {
  const sql = read("prisma/sql/39-discount-created-by.sql");
  assert.match(sql, /ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "createdById" TEXT;/);
  assert.match(sql, /ON DELETE SET NULL/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "discounts_tenantId_createdById_idx"/);
  assert.match(sql, /-- Verification/);
  assert.doesNotMatch(sql, /DROP |DELETE FROM|UPDATE "discounts"|SET NOT NULL|TEXT NOT NULL/);
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /createdById String\?\n\s+createdBy\s+User\?\s+@relation\("DiscountCreatedBy", fields: \[createdById\], references: \[id\], onDelete: SetNull\)/);
});

test("SQL 40: nullable partnerId + FK SET NULL + index, backfill ΜΟΝΟ από δημιουργό-συνεργάτη της ίδιας εταιρίας, verification", () => {
  const sql = read("prisma/sql/40-discount-partner.sql");
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "partnerId" TEXT;/);
  assert.match(sql, /FOREIGN KEY \("partnerId"\) REFERENCES "users"\("id"\) ON DELETE SET NULL/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "discounts_tenantId_partnerId_idx" ON "discounts" \("tenantId", "partnerId"\);/);
  // Backfill: ένα UPDATE, μόνο partnerId IS NULL, δημιουργός PARTNER της ΙΔΙΑΣ εταιρίας.
  assert.equal((sql.match(/^UPDATE /gm) ?? []).length, 1);
  assert.match(sql, /SET "partnerId" = d\."createdById"/);
  assert.match(sql, /WHERE d\."partnerId" IS NULL/);
  assert.match(sql, /AND u\."role" = 'PARTNER'::"UserRole"/);
  assert.match(sql, /AND u\."tenantId" = d\."tenantId";/);
  assert.doesNotMatch(sql, /DROP |DELETE FROM|"bookings"|SET NOT NULL|TEXT NOT NULL|"createdById" =/);
  assert.match(sql, /AS bad_partner_links/);
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /partnerId String\?\n\s+partner\s+User\?\s+@relation\("DiscountPartner", fields: \[partnerId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(schema, /@@index\(\[tenantId, partnerId\]\)/);
});
