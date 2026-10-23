// tests/user-delete.test.mjs
// Οριστική διαγραφή χρήστη (SQL 35): κανόνες (canHardDelete), ροή της
// διαγραφής (μία transaction, ιστορικό μένει), εμφάνιση «Διαγραμμένος χρήστης».
// Καθαρή λογική + στατικοί έλεγχοι — χωρίς βάση. Η ολοκληρωμένη δοκιμή με
// βάση/HTTP: tests/e2e/user-delete.e2e.mjs.

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

const A = await import("../src/lib/adminRole.ts");
const P = await import("../src/lib/priceOverride.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const admin = { id: "a1", role: "COMPANY_ADMIN", tenantId: "t1" };
const staffT = { id: "s1", role: "STAFF", tenantId: "t1", isActive: true };

test("Διαχειριστής διαγράφει χρήστη της εταιρίας του", () => {
  assert.deepEqual(A.canHardDelete(admin, staffT, 0), { ok: true });
  assert.deepEqual(A.canHardDelete(admin, { ...staffT, role: "PARTNER" }, 0), { ok: true });
  assert.deepEqual(A.canHardDelete(admin, { ...staffT, isActive: false }, 0), { ok: true }, "και απενεργοποιημένο");
});

test("όχι τον εαυτό του", () => {
  const r = A.canHardDelete(admin, { id: "a1", role: "COMPANY_ADMIN", tenantId: "t1", isActive: true }, 3);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("όχι τον τελευταίο ενεργό Διαχειριστή", () => {
  const other = { id: "a2", role: "COMPANY_ADMIN", tenantId: "t1", isActive: true };
  const r = A.canHardDelete(admin, other, 0);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(A.canHardDelete(admin, other, 1).ok, true, "με άλλον ενεργό Διαχειριστή επιτρέπεται");
});

test("χρήστης άλλης εταιρίας → 404 (ούτε μαρτυράμε ότι υπάρχει)", () => {
  const r = A.canHardDelete(admin, { ...staffT, tenantId: "t2" }, 5);
  assert.equal(r.status, 404);
  assert.equal(A.canHardDelete(admin, null, 5).status, 404);
});

test("Staff / Partner / Super Admin → 403, ακόμη και για χρήστη της ίδιας εταιρίας", () => {
  for (const role of ["STAFF", "PARTNER"]) {
    assert.equal(A.canHardDelete({ id: "x", role, tenantId: "t1" }, staffT, 5).status, 403, role);
  }
  assert.equal(A.canHardDelete({ id: "sa", role: "SUPER_ADMIN", tenantId: null }, staffT, 5).status, 403);
});

test("ροή: ΜΙΑ transaction, ιστορικό μένει, μόνο η γραμμή του χρήστη σβήνεται", () => {
  const src = read("src/lib/userDelete.ts");
  const tx = src.slice(src.indexOf("return db.$transaction"));
  assert.match(tx, /tx\.user\.delete\(\{ where: \{ id \} \}\)/);
  // Καμία διαγραφή ιστορικών εγγραφών
  assert.doesNotMatch(tx, /tx\.(booking|contract|invoice|activityLog|customer|bookingPayment|bookingNotification)\.delete/);
  assert.match(tx, /createdByDeleted: true, createdById: null/);
  assert.match(tx, /partnerDeleted: true, partnerId: null/);
  assert.match(tx, /createdById: null, createdByName: null, createdByDeleted: true/);
  assert.match(tx, /#- '\{priceOverride,userName\}'/);
  assert.match(tx, /refreshSearchText\(c\.id, tx\)/, "το όνομα φεύγει και από το κείμενο αναζήτησης");
  // Κάθε ενημέρωση φιλτράρει με την εταιρία
  for (const m of tx.matchAll(/updateMany\(\{ where: \{([^}]*)\}/g)) assert.match(m[1], /tenantId/, m[1]);
  // Τελευταίος Διαχειριστής: έλεγχος ΜΕΣΑ στη transaction με κλείδωμα γραμμών
  assert.match(src, /FOR UPDATE/);
});

test("χειροκίνητη τιμή συμβολαίου: σημάδι userDeleted χωρίς όνομα", () => {
  const o = P.readPriceOverride({ manualRental: 50, computedRental: 40, userDeleted: true, at: "2026-10-23T10:00:00Z" });
  assert.equal(o.userDeleted, true);
  assert.equal(o.userName, undefined);
  assert.equal(P.readPriceOverride({ manualRental: 50, userName: "Χ" }).userDeleted, undefined);
});

test("εμφάνιση: «Διαγραμμένος χρήστης» αντί για όνομα σε κρατήσεις, ιστορικό, συμβόλαια", () => {
  assert.match(read("src/lib/i18n/el.ts"), /deletedUser: "Διαγραμμένος χρήστης"/);
  assert.match(read("src/lib/i18n/en.ts"), /deletedUser: "Deleted user"/);
  assert.match(read("src/lib/bookings.ts"), /createdByDeleted: b\.createdByDeleted \?\? false/);
  assert.match(read("src/app/(dashboard)/dashboard/bookings/BookingsClient.tsx"), /b\.createdByName \?\? tr\("common\.deletedUser"\)/);
  assert.match(read("src/app/api/bookings/[id]/decision/route.ts"), /byDeleted: h\.userId === null/);
  assert.match(read("src/lib/contracts.ts"), /c\.createdByDeleted \? DELETED_USER_LABEL : c\.createdByName/);
  assert.match(read("src/lib/contractForm.ts"), /createdByName: issuerName\(c\)/);
});

test("UI: κουμπί «Διαγραφή» δίπλα στην «Απενεργοποίηση», επιβεβαίωση οριστικής ενέργειας", () => {
  const ui = read("src/app/(dashboard)/dashboard/users/UsersClient.tsx");
  assert.match(ui, /fetch\(`\/api\/users\/\$\{user\.id\}`, \{ method: "DELETE" \}\)/);
  assert.match(ui, /fetch\(`\/api\/company-users\/\$\{user\.id\}`, \{\s*method: "DELETE",/, "η Απενεργοποίηση μένει ίδια");
  assert.match(read("src/lib/i18n/el.ts"), /Η ενέργεια είναι ΟΡΙΣΤΙΚΗ και δεν αναιρείται/);
});

test("SQL 35: idempotent, activity_logs SET NULL, σημάδια, verification", () => {
  const sql = read("prisma/sql/35-user-hard-delete.sql");
  assert.match(sql, /ALTER COLUMN "userId" DROP NOT NULL/);
  assert.match(sql, /ON DELETE SET NULL/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "createdByDeleted" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "partnerDeleted"/);
  assert.match(sql, /αναμενόμενο: activity_nullable = YES · fk_set_null = 3 · new_columns = 3 · flagged_rows = 0/);
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|DROP COLUMN/);
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /user   User\?   @relation\(fields: \[userId\], references: \[id\], onDelete: SetNull\)/);
});
