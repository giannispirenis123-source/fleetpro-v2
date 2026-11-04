// tests/partner-discounts.test.mjs — κωδικοί έκπτωσης συνεργάτη: έκπτωση ως την
// προμήθειά του (ίση επιτρέπεται), μόνο ποσοστό, ορατότητα/επεξεργασία ΜΟΝΟ
// των δικών του κωδικών (στον server), ο Διαχειριστής όπως πριν. SQL 39.

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

test("server: POST και PATCH ελέγχουν το όριο (400, τίποτα δεν γράφεται)· μόνο για συνεργάτη", () => {
  const post = read("src/app/api/discounts/route.ts");
  const i = post.indexOf("partnerDiscountProblem(data, await partnerCommission(viewer!))");
  assert.ok(i > 0 && i < post.indexOf("db.discount.create"), "ο έλεγχος ΠΡΙΝ από τη δημιουργία");
  assert.match(post, /if \(partnerProblem\) return badRequest\(partnerProblem\);/);
  assert.match(post, /createdById: viewer!\.userId,/);
  const patch = read("src/app/api/discounts/[id]/route.ts");
  const j = patch.indexOf("partnerDiscountProblem(merged, await partnerCommission(viewer!))");
  assert.ok(j > 0 && j < patch.indexOf("db.discount.update"), "ο έλεγχος ΠΡΙΝ από την αποθήκευση");
  const access = read("src/lib/discountAccess.ts");
  assert.match(access, /if \(viewer\.role !== "PARTNER"\) return null;/);
  assert.match(access, /if \(!settings\) return null; \/\/ όχι συνεργάτης: καμία αλλαγή/);
  assert.match(access, /Η έκπτωση δεν μπορεί να ξεπερνά την προμήθειά σου/);
});

test("ορατότητα: ο συνεργάτης ΜΟΝΟ τους δικούς του (λίστα, σελίδα, επεξεργασία, απενεργοποίηση)· οι άλλοι όλους", () => {
  const access = read("src/lib/discountAccess.ts");
  assert.match(access, /return viewer\.role === "PARTNER" \? \{ \.\.\.base, createdById: viewer\.userId \} : base;/);
  const list = read("src/app/api/discounts/route.ts");
  assert.match(list, /where: \{\s+\.\.\.discountScope\(viewer!\),/);
  const byId = read("src/app/api/discounts/[id]/route.ts");
  assert.equal((byId.match(/where: \{ id: params!\.id, \.\.\.discountScope\(viewer!\) \}/g) ?? []).length, 2, "PATCH και DELETE");
  assert.doesNotMatch(byId, /where: \{ id: params!\.id, tenantId: session\.tenantId! \}/);
  const page = read("src/app/(dashboard)/dashboard/discounts/page.tsx");
  assert.match(page, /where: discountScope\(viewer\),/);
  // Ο συνεργάτης δεν παίρνει τη λίστα πελατών της εταιρίας.
  assert.match(page, /partner\s+\? Promise\.resolve\(\[\]\)/);
  // Κανένα άλλο ερώτημα κωδικών στο dashboard/API χωρίς το φίλτρο.
  for (const f of ["src/app/api/discounts/route.ts", "src/app/api/discounts/[id]/route.ts", "src/app/(dashboard)/dashboard/discounts/page.tsx"]) {
    const s = read(f);
    for (const m of s.matchAll(/db\.discount\.(findMany|findFirst|findUnique|update|delete|count)\(\{[\s\S]*?where: ([\s\S]{0,120})/g)) {
      // Επιτρέπονται: discountScope, το ήδη ελεγμένο current.id, και ο έλεγχος μοναδικότητας κωδικού.
      const ok = /discountScope|id: current\.id|tenantId: session\.tenantId!, code/.test(m[2]);
      assert.ok(ok, `${f}: ${m[1]} where ${m[2]}`);
    }
  }
});

test("φόρμα: μέγιστο ποσοστό, μήνυμα ΕΛ/EN, μόνο ποσοστό για συνεργάτη", () => {
  const el = read("src/lib/i18n/el.ts");
  const en = read("src/lib/i18n/en.ts");
  assert.match(el, /partnerOverCommission: "Η έκπτωση δεν μπορεί να ξεπερνά την προμήθειά σου \(\{max\}\)\."/);
  assert.match(en, /partnerOverCommission: "The discount cannot exceed your commission \(\{max\}\)\."/);
  assert.match(el, /partnerMax: "Μέγιστη έκπτωση: \{max\} \(η προμήθειά σου\)"/);
  const ui = read("src/app/(dashboard)/dashboard/discounts/DiscountsClient.tsx");
  assert.match(ui, /max=\{form\.type === "PERCENTAGE" \? \(isPartner \? partnerMaxPercent! : 100\) : undefined\}/);
  assert.match(ui, /data-testid="discount-max"/);
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
