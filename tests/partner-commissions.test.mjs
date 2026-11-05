// tests/partner-commissions.test.mjs — «Προμήθειες συνεργατών» (Διαχειριστής /
// προσωπικό με «commission.partners»): ΙΔΙΟΣ υπολογισμός με τα «Οικονομικά»
// του συνεργάτη, δικαίωμα ατικάριστο από προεπιλογή, ποτέ σε συνεργάτη,
// εταιρία μόνο από το session.

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

const P = await import("../src/lib/permissions.ts");
const C = await import("../src/lib/commission.ts");
const F = await import("../src/lib/partnerFinance.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("δικαίωμα «commission.partners»: ατικάριστο για υπάρχοντες/νέους, ποτέ σε συνεργάτη, Διαχειριστής πάντα", () => {
  assert.ok(P.ALL_PERMISSIONS.includes("commission.partners"));
  assert.ok(!P.STAFF_DEFAULTS.includes("commission.partners"));
  assert.ok(!P.PARTNER_DEFAULTS.includes("commission.partners"));
  assert.equal(P.can("STAFF", P.defaultsForRole("STAFF"), "commission.partners"), false);
  assert.equal(P.can("STAFF", { "commission.partners": true }, "commission.partners"), true);
  assert.equal(P.can("COMPANY_ADMIN", {}, "commission.partners"), true);
  // Συνεργάτης: ποτέ, ακόμη κι αν το γράφει το JSON· η δική του προμήθεια μένει.
  assert.ok(P.PARTNER_NEVER.has("commission.partners"));
  assert.equal(P.can("PARTNER", { "commission.partners": true, "commission.view": true }, "commission.partners"), false);
  assert.equal(P.can("PARTNER", { "commission.view": true }, "commission.view"), true);
  // Στο παράθυρο δικαιωμάτων: φαίνεται στο προσωπικό, όχι στον συνεργάτη.
  const keys = (role) => P.groupsForRole(role).flatMap((g) => g.items.map((i) => i.key));
  assert.ok(keys("STAFF").includes("commission.partners"));
  assert.ok(!keys("PARTNER").includes("commission.partners") && keys("PARTNER").includes("commission.view"));
  const ui = read("src/app/(dashboard)/dashboard/users/UsersClient.tsx");
  assert.match(ui, /staffCommissionPartners: false,/);
  assert.match(ui, /data-testid="staff-access-commission-partners"/);
});

test("ΙΔΙΟΣ υπολογισμός με τα «Οικονομικά» του συνεργάτη (ίδιο select, μετατροπή, μήνας, ρυθμίσεις)", () => {
  const s = read("src/lib/partnerServer.ts");
  // Και οι τρεις φορτώσεις περνούν από τα ίδια κομμάτια.
  for (const fn of ["loadPartnerFinance", "loadPartnerCommissions", "loadPartnerCommissionDetail"]) {
    const body = s.slice(s.indexOf(`export async function ${fn}`), s.indexOf("\n}\n", s.indexOf(`export async function ${fn}`)));
    assert.match(body, /select: FINANCE_SELECT/, fn);
    assert.match(body, /\.\.\.pickupIn\(month\)/, fn);
    assert.match(body, /partnerFinance\(/, fn);
    assert.match(body, /toFinanceInput/, fn);
  }
  // Οι ρυθμίσεις προμήθειας: η ΙΔΙΑ μετατροπή (commissionSettingsOf) για συνεργάτη και Διαχειριστή.
  assert.match(read("src/lib/listServer.ts"), /return commissionSettingsOf\(me\);/);
  assert.match(s, /const settings = commissionSettingsOf\(p\) \?\? NO_COMMISSION;/);
  assert.match(s, /const settings = commissionSettingsOf\(partner\) \?\? NO_COMMISSION;/);
  assert.deepEqual(C.commissionSettingsOf({ commissionRate: "20.00", commissionOnRental: true, commissionOnExtras: true, commissionOnInsurance: false }), { rate: 20, onRental: true, onExtras: true, onInsurance: false });
  assert.equal(C.commissionSettingsOf({ commissionRate: 0 }), null);
  // Ίδια ημερομηνία αναφοράς με τα «Οικονομικά».
  assert.match(read("src/app/(dashboard)/dashboard/partner-commissions/page.tsx"), /const month = currentMonth\(\);/);
  assert.match(read("src/app/(dashboard)/dashboard/partner/finance/page.tsx"), /const month = currentMonth\(\);/);
});

test("σύνολα: ακυρωμένες και με πλήρη επιστροφή δεν μετράνε· χωρίς κρατήσεις → μηδενικά", () => {
  const S = { rate: 20, onRental: true, onExtras: false, onInsurance: false };
  const row = (id, status, cents, sub, pay = "NONE") => ({ id, bookingNumber: id, pickupDate: "2026-11-05", returnDate: "2026-11-06", vehicle: "V", status, paymentStatus: pay, totalCents: cents, subtotal: sub, extrasTotal: 0, insuranceCost: 0 });
  const r = F.partnerFinance([row("a", "CONFIRMED", 10000, 80), row("b", "CANCELLED", 50000, 400), row("c", "COMPLETED", 20000, 150, "REFUNDED")], S);
  assert.deepEqual(r.totals, { bookings: 1, totalCents: 10000, commissionCents: 1600 });
  assert.deepEqual(F.partnerFinance([], S).totals, { bookings: 0, totalCents: 0, commissionCents: 0 });
  // Οι συνεργάτες χωρίς κρατήσεις ΜΕΝΟΥΝ στη λίστα (map πάνω σε όλους τους συνεργάτες).
  assert.match(read("src/lib/partnerServer.ts"), /partnerFinance\(\(byPartner\.get\(p\.id\) \?\? \[\]\)\.map\(toFinanceInput\), settings\)/);
});

test("πρόσβαση και απομόνωση: φύλακας στον server, εταιρία ΜΟΝΟ από το session, συνεργάτης 403", () => {
  for (const f of ["src/app/api/partner-commissions/route.ts", "src/app/api/partner-commissions/[id]/route.ts"]) {
    const s = read(f);
    assert.match(s, /export const GET = withPermission\(/, f);
    assert.ok(s.trimEnd().endsWith('"commission.partners"\n);'), f);
    assert.match(s, /if \(!viewer\?\.tenantId \|\| viewer\.role === "PARTNER" \|\| viewer\.role === "SUPER_ADMIN"\) return forbidden\(\);/, f);
    assert.match(s, /viewer\.tenantId/, f);
    assert.doesNotMatch(s, /searchParams\.get\("tenant/, f);
  }
  const srv = read("src/lib/partnerServer.ts");
  assert.match(srv, /where: \{ tenantId, role: "PARTNER" \}/);
  assert.match(srv, /where: \{ tenantId, partnerId: \{ in: partners\.map\(\(p\) => p\.id\) \}, \.\.\.pickupIn\(month\) \}/);
  assert.match(srv, /db\.user\.findFirst\(\{ where: \{ id: partnerId, tenantId, role: "PARTNER" \}/);
  assert.match(read("src/app/(dashboard)/dashboard/partner-commissions/page.tsx"), /pageGuard\("commission\.partners"\);\s+if \(!guard \|\| isPartner\(guard\.viewer\)\) redirect/);
  // Τα «Οικονομικά» του συνεργάτη ΔΕΝ άλλαξαν συμπεριφορά: μόνο οι δικές του κρατήσεις.
  assert.match(srv, /const scope = bookingScope\(viewer\); \/\/ \{ tenantId, partnerId: ο ίδιος \}/);
});
