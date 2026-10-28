// tests/tenant-delete.test.mjs
// Οριστική διαγραφή εταιρίας (Super Admin): κάλυψη ΟΛΩΝ των πινάκων με
// "tenantId" (βρίσκονται αυτόματα από το schema.prisma — νέος πίνακας που
// ξεχνιέται σπάει εδώ), κανόνες (ακριβές όνομα, ζωντανή συνδρομή), φύλακας
// στον server, κουμπί στο UI. Με πραγματική βάση: tests/e2e/tenant-delete.db.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const D = await import("../src/lib/tenantDeleteCore.ts");

/** Μοντέλα του schema.prisma με πεδίο tenantId → όνομα πίνακα (@@map). */
function tenantTablesFromSchema() {
  const schema = read("prisma/schema.prisma");
  const out = [];
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const body = m[2];
    if (!/^\s+tenantId\s+String/m.test(body)) continue;
    const map = body.match(/@@map\("([^"]+)"\)/);
    out.push(map ? map[1] : m[1]);
  }
  return out.sort();
}

test("ΚΑΘΕ πίνακας με tenantId καλύπτεται από τη διαγραφή εταιρίας (αυτόματη εύρεση)", () => {
  const found = tenantTablesFromSchema();
  assert.ok(found.length >= 29, `βρέθηκαν ${found.length}`);
  const covered = new Set([...D.TENANT_TABLES, ...D.TENANT_TABLES_SPECIAL]);
  assert.deepEqual(found.filter((t) => !covered.has(t)), [], "πίνακες με tenantId που ΔΕΝ σβήνονται");
  assert.deepEqual([...covered].filter((t) => !found.includes(t)).sort(), [], "πίνακες στη λίστα που δεν υπάρχουν");
  // Κανένας διπλός, και οι χρήστες τελευταίοι (ελευθερώνονται τα emails).
  assert.equal(new Set(D.TENANT_TABLES).size, D.TENANT_TABLES.length);
  assert.equal(D.TENANT_TABLES.at(-1), "users");
});

test("σειρά: παιδιά πριν από τους γονείς (RESTRICT bookings → vehicles/customers, contracts/invoices → bookings)", () => {
  const i = (t) => D.TENANT_TABLES.indexOf(t);
  for (const [child, parent] of [
    ["bookings", "vehicles"],
    ["bookings", "customers"],
    ["contracts", "bookings"],
    ["invoices", "bookings"],
    ["booking_payments", "bookings"],
    ["service_records", "vehicles"],
    ["damages", "vehicles"],
    ["rates", "seasons"],
    ["rates", "rental_groups"],
    ["reviews", "pickup_locations"],
    ["contracts", "contract_templates"],
  ]) {
    assert.ok(i(child) < i(parent), `${child} πριν από ${parent}`);
  }
});

test("ζωντανή συνδρομή Stripe → μπλοκάρισμα «Ακύρωσε πρώτα»· χωρίς συνδρομή ή ακυρωμένη → επιτρέπεται", () => {
  for (const s of ["active", "trialing", "past_due", "unpaid"]) {
    assert.match(D.deleteBlockReason({ billingStatus: s, stripeSubId: "sub_1" }), /Ακύρωσε πρώτα/);
  }
  assert.equal(D.deleteBlockReason({ billingStatus: "active", stripeSubId: null }), null);
  assert.equal(D.deleteBlockReason({ billingStatus: "canceled", stripeSubId: "sub_1" }), null);
  assert.equal(D.deleteBlockReason({ billingStatus: "exempt", stripeSubId: null }), null);
  assert.equal(D.deleteBlockReason({ billingStatus: "founder_trial", stripeSubId: null }), null);
});

test("επιβεβαίωση: ΑΚΡΙΒΕΣ όνομα (μόνο κενά στις άκρες αγνοούνται)", () => {
  assert.equal(D.nameConfirmed("Fleet-Pro Car Rental", "Fleet-Pro Car Rental"), true);
  assert.equal(D.nameConfirmed("  Fleet-Pro Car Rental ", "Fleet-Pro Car Rental"), true);
  assert.equal(D.nameConfirmed("fleet-pro car rental", "Fleet-Pro Car Rental"), false);
  assert.equal(D.nameConfirmed("Fleet-Pro", "Fleet-Pro Car Rental"), false);
  assert.equal(D.nameConfirmed("", ""), false);
  assert.equal(D.nameConfirmed(undefined, "X"), false);
  assert.equal(D.nameConfirmed(["X"], "X"), false);
});

test("server: μόνο Super Admin, μία transaction, κάθε DELETE με WHERE tenantId, το Stripe ΔΕΝ καλείται", () => {
  const route = read("src/app/api/tenants/[id]/route.ts");
  const del = route.slice(route.indexOf("export const DELETE"));
  assert.match(del, /\["SUPER_ADMIN"\]/);
  assert.match(del, /deleteTenant\(params!\.id, \{/);
  assert.match(read("src/app/api/tenants/[id]/deletion/route.ts"), /\["SUPER_ADMIN"\]/);
  const lib = read("src/lib/tenantDelete.ts");
  assert.match(lib, /db\.\$transaction\(/);
  assert.match(lib, /FOR UPDATE/);
  assert.match(lib, /for \(const table of TENANT_TABLES\)/);
  assert.match(lib, /DELETE FROM \$\{Prisma\.raw\(`"\$\{table\}"`\)\} WHERE "tenantId" = \$\{id\}/);
  assert.match(lib, /nameConfirmed\(input\.confirmName, t\.name\)/);
  assert.match(lib, /deleteBlockReason\(t\)/);
  assert.doesNotMatch(lib, /stripe\(|from "\.\/stripeConnect"|subscriptions\.(cancel|del)/);
  // Θέση ιδρυτή: μόνο με ρητό τικ, ασφαλής μείωση στην ίδια transaction.
  assert.match(lib, /if \(input\.releaseFounderSlot\)/);
  assert.match(lib, /GREATEST\("claimedCount" - 1, 0\)/);
  // Cloudinary: ΜΕΤΑ τη transaction, με όριο χρόνου, μόνο κωδικός στα logs.
  assert.ok(lib.indexOf("destroyCompanyFolder(") > lib.indexOf("{ timeout: 60_000"));
  assert.match(lib, /withTimeout\(destroyCompanyFolder\(/);
  // Log: μόνο id, όνομα εταιρίας, ημερομηνία.
  assert.match(lib, /console\.info\(`\[FleetPro\] Διαγραφή εταιρίας: id=\$\{result\.id\} name=\$\{JSON\.stringify\(result\.name\)\} at=\$\{now\.toISOString\(\)\}`\)/);
  // Ο client στέλνει μόνο όνομα + τικ.
  assert.match(route, /releaseFounderSlot: body\.releaseFounderSlot === true/);
});

test("νέα θέση ιδρυτή = η μικρότερη ελεύθερη (μετά από απελευθέρωση δεν συγκρούεται)", () => {
  assert.match(read("src/lib/billing/foundingServer.ts"), /SELECT min\(n\)::int AS n FROM generate_series\(1, 10\) AS n\s+WHERE n NOT IN \(SELECT "slotNumber" FROM "founder_claims"\)/);
});

test("UI: το «Διαγραφή εταιρίας» ανοίγει επιβεβαίωση (όχι κουμπί χωρίς ενέργεια) και φαίνεται στο κινητό", () => {
  const sa = read("src/app/(super-admin)/super-admin/page.tsx");
  assert.doesNotMatch(sa, /<button className="danger">\s*<Trash2/);
  assert.match(sa, /onClick=\{onDelete\} data-testid="tenant-delete"/);
  assert.match(sa, /data-testid="edit-tenant-delete"/);
  assert.match(sa, /disabled=\{busy \|\| !summary \|\| Boolean\(summary\.blocked\) \|\| !matches\}/);
  assert.match(sa, /\.sa-table-wrap \{ overflow-x: auto;/);
  assert.match(sa, /\.sa-table-row td:last-child, \.sa-table thead th:last-child \{\s*position: sticky; right: 0;/);
});
