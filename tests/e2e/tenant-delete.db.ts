// tests/e2e/tenant-delete.db.ts
// Οριστική διαγραφή εταιρίας με ΠΡΑΓΜΑΤΙΚΗ PostgreSQL — ο ΙΔΙΟΣ κώδικας με
// το DELETE /api/tenants/[id] (deleteTenant).
//
// ΜΟΝΟ τοπικά, σε ΔΟΚΙΜΑΣΤΙΚΗ βάση (φτιάχνει και σβήνει εταιρίες "tdtest-").
//   DATABASE_URL=postgresql://…/fleetpro_test npx tsx --test tests/e2e/tenant-delete.db.ts
//
// · Δύο εταιρίες Α και Β με δεδομένα σε ΚΑΘΕ πίνακα με tenantId. Διαγραφή της
//   Α → 0 γραμμές της Α παντού, η Β ΑΚΡΙΒΩΣ ίδια (πλήθος ανά πίνακα).
// · Οι πίνακες βρίσκονται αυτόματα από το information_schema· νέος πίνακας
//   που δεν καλύπτεται από τη διαγραφή → αποτυχία.
// · Λάθος όνομα → τίποτα δεν σβήνεται. Ζωντανή συνδρομή → μπλοκάρισμα.
// · Θέση ιδρυτή: προεπιλογή μένει πιασμένη· με τικ απελευθερώνεται και η
//   επόμενη διεκδίκηση παίρνει την ελεύθερη θέση.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient, Prisma } from "@prisma/client";
import { deleteTenant, TenantDeleteError } from "../../src/lib/tenantDelete";
import { TENANT_TABLES, TENANT_TABLES_SPECIAL } from "../../src/lib/tenantDeleteCore";
import { claimFounderSlot } from "../../src/lib/billing/foundingServer";
import { hashFounderCode } from "../../src/lib/billing/founding";

const db = new PrismaClient();
const P = "tdtest-";

async function tenantTables(): Promise<string[]> {
  const rows = await db.$queryRaw<{ t: string }[]>`
    SELECT table_name AS t FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'tenantId' ORDER BY 1`;
  return rows.map((r) => r.t);
}

async function countsFor(tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await tenantTables()) {
    const r = await db.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT count(*)::int AS n FROM ${Prisma.raw(`"${t}"`)} WHERE "tenantId" = ${tenantId}`
    );
    out[t] = r[0].n;
  }
  return out;
}

/** Μία εταιρία με γραμμές σε ΚΑΘΕ πίνακα με tenantId. */
async function seedTenant(key: string, opts: { founderCode?: string } = {}) {
  const id = `${P}${key}`;
  const x = (s: string) => `${id}-${s}`;
  await db.$transaction(async (tx) => {
    await tx.tenant.create({ data: { id, name: `TD ${key} Ενοικιάσεις`, slug: id, email: `${id}@example.test` } });
    await tx.user.create({ data: { id: x("u"), tenantId: id, email: `${x("u")}@example.test`, passwordHash: "x", name: "U", role: "COMPANY_ADMIN", permissions: {} } });
    await tx.session.create({ data: { userId: x("u"), token: x("sess"), expiresAt: new Date(Date.now() + 1e9) } }).catch(() => undefined);
    await tx.emailVerificationToken.create({ data: { userId: x("u"), tokenHash: x("tok"), expiresAt: new Date(Date.now() + 1e9) } });
    await tx.rentalGroup.create({ data: { id: x("g"), tenantId: id, code: "A", name: {} } });
    await tx.vehicle.create({ data: { id: x("v"), tenantId: id, brand: "Fiat", model: "Panda", plate: `TD-${key}`, year: 2022, dailyRate: 30, rentalGroupId: x("g") } });
    await tx.customer.create({ data: { id: x("c"), tenantId: id, firstName: "Α", lastName: "Β" } });
    await tx.booking.create({
      data: {
        id: x("b"), tenantId: id, vehicleId: x("v"), customerId: x("c"), bookingNumber: "1", createdById: x("u"),
        pickupDate: new Date(), returnDate: new Date(), dailyRate: 30, totalDays: 1, subtotal: 30, total: 30,
      },
    });
    await tx.contractTemplate.create({ data: { id: x("ct"), tenantId: id, name: "T", content: "x" } });
    await tx.contract.create({ data: { id: x("k"), tenantId: id, bookingId: x("b"), customerId: x("c"), contractNumber: "1", templateId: x("ct") } });
    await tx.invoice.create({ data: { id: x("i"), tenantId: id, bookingId: x("b"), customerId: x("c"), invoiceNumber: "1", dueDate: new Date(), subtotal: 30, taxAmount: 0, total: 30 } });
    await tx.activityLog.create({ data: { tenantId: id, userId: x("u"), action: "x", entity: "x", entityId: "x" } });
    await tx.tenantFeedback.create({ data: { tenantId: id, userId: x("u"), vehicleCount: 3 } });
    await tx.founderInvoice.create({ data: { stripeInvoiceId: x("in"), tenantId: id, months: 1 } });
    await tx.founderFullCharge.create({ data: { stripeInvoiceId: x("full"), tenantId: id, amountCents: 3900 } });
  });
  // Οι υπόλοιποι πίνακες με tenantId: μία γραμμή με τα ελάχιστα (raw, για να μη
  // δένεται το τεστ με κάθε πεδίο). Ό,τι δεν μπαίνει εύκολα γεμίζει από τα παραπάνω.
  // $1 = id γραμμής, $2 = εταιρία, $3 = όχημα, $4 = κράτηση. Αποτυχία = λάθος του τεστ (όχι σιωπή).
  const simple: [string, string][] = [
    ["extras", `INSERT INTO "extras" ("id","tenantId","name","price","updatedAt") VALUES ($1,$2,'x',1,now())`],
    ["discounts", `INSERT INTO "discounts" ("id","tenantId","name","value","updatedAt") VALUES ($1,$2,'x',1,now())`],
    ["expenses", `INSERT INTO "expenses" ("id","tenantId","type","amount","date","updatedAt","vehicleId") VALUES ($1,$2,'x',1,now(),now(),$3)`],
    ["notifications", `INSERT INTO "notifications" ("id","tenantId","type","title","message") VALUES ($1,$2,'BOOKING_CANCELLED','x','x')`],
    ["seasons", `INSERT INTO "seasons" ("id","tenantId","startMonthDay","endMonthDay") VALUES ($1,$2,'01-01','02-01')`],
    ["pickup_locations", `INSERT INTO "pickup_locations" ("id","tenantId","slug") VALUES ($1,$2,$1)`],
    ["places", `INSERT INTO "places" ("id","tenantId","slug") VALUES ($1,$2,$1)`],
    ["platform_discounts", `INSERT INTO "platform_discounts" ("id","tenantId","type","value","validFrom") VALUES ($1,$2,'FIXED_AMOUNT',10,'2026-01-01')`],
    ["promotions", `INSERT INTO "promotions" ("id","tenantId","discountValue","validFrom","validTo") VALUES ($1,$2,10,'2026-01-01','2026-02-01')`],
    ["driver_age_bands", `INSERT INTO "driver_age_bands" ("id","tenantId","minAge","maxAge") VALUES ($1,$2,21,99)`],
    ["rates", `INSERT INTO "rates" ("id","tenantId","vehicleId") VALUES ($1,$2,$3)`],
    ["reviews", `INSERT INTO "reviews" ("id","tenantId","authorName","rating") VALUES ($1,$2,'x',5)`],
    ["damages", `INSERT INTO "damages" ("id","tenantId","vehicleId","description","updatedAt","bookingId") VALUES ($1,$2,$3,'x',now(),$4)`],
    ["service_records", `INSERT INTO "service_records" ("id","tenantId","vehicleId","type","date","updatedAt") VALUES ($1,$2,$3,'BATTERY',now(),now())`],
    ["booking_payments", `INSERT INTO "booking_payments" ("id","tenantId","bookingId","stripeAccountId","stripeCheckoutSessionId","amountCents") VALUES ($1,$2,$4,'acct_x',$1,100)`],
    ["booking_notifications", `INSERT INTO "booking_notifications" ("id","tenantId","bookingId","kind","channel","result") VALUES ($1,$2,$4,'confirm','email','sent')`],
    ["site_legal_texts", `INSERT INTO "site_legal_texts" ("id","tenantId","kind","lang","version","body") VALUES ($1,$2,'terms','el',1,'x')`],
  ];
  for (const [t, sql] of simple) {
    await db.$executeRawUnsafe(sql, x(t), id, x("v"), x("b"));
  }
  if (opts.founderCode) {
    await db.$transaction((tx) => claimFounderSlot(tx, opts.founderCode!, id));
  }
  return id;
}

async function cleanup() {
  await db.founderClaim.deleteMany({ where: { code: { label: { startsWith: P } } } });
  await db.founderCode.deleteMany({ where: { label: { startsWith: P } } });
  await db.tenant.deleteMany({ where: { id: { startsWith: P } } });
  await db.foundingProgram.update({ where: { id: "founding" }, data: { claimedCount: await db.founderClaim.count() } });
}

before(cleanup);
after(async () => {
  await cleanup();
  await db.$disconnect();
});

test("κάθε πίνακας με tenantId στη βάση καλύπτεται από τη διαγραφή", async () => {
  const covered = new Set<string>([...TENANT_TABLES, ...TENANT_TABLES_SPECIAL]);
  assert.deepEqual((await tenantTables()).filter((t) => !covered.has(t)), []);
});

test("διαγραφή της Α: 0 γραμμές της Α παντού, η Β ΑΚΡΙΒΩΣ ίδια, emails ελεύθερα", async () => {
  await db.founderCode.create({ data: { codeHash: hashFounderCode("TDCODEAB0"), label: `${P}ab`, maxClaims: 2 } });
  const a = await seedTenant("a", { founderCode: "TDCODEAB0" });
  const b = await seedTenant("b", { founderCode: "TDCODEAB0" });
  const beforeA = await countsFor(a);
  const beforeB = await countsFor(b);
  const filled = Object.entries(beforeA).filter(([, n]) => n > 0).map(([t]) => t);
  console.log(`γεμάτοι πίνακες: ${filled.length}/${Object.keys(beforeA).length}`);
  assert.equal(filled.length, Object.keys(beforeA).length, `γεμάτοι πίνακες για την Α: ${filled.join(", ")}`);
  assert.deepEqual(beforeA, beforeB);
  // founder_claims: η θέση της Α μένει (χωρίς εταιρία) — 0 γραμμές «της Α».

  await deleteTenant(a, { confirmName: "TD a Ενοικιάσεις" });

  const afterA = await countsFor(a);
  assert.ok(Object.values(afterA).every((n) => n === 0), JSON.stringify(afterA));
  assert.deepEqual(await countsFor(b), beforeB, "η Β άλλαξε");
  assert.equal(await db.tenant.count({ where: { id: a } }), 0);
  assert.equal(await db.user.count({ where: { email: `${a}-u@example.test` } }), 0, "το email δεν ελευθερώθηκε");
  assert.equal(await db.emailVerificationToken.count({ where: { userId: `${a}-u` } }), 0);
  assert.equal(await db.user.count({ where: { tenantId: b } }), 1);
});

test("λάθος όνομα → 400 και ΤΙΠΟΤΑ δεν σβήνεται", async () => {
  const c = await seedTenant("c");
  const before = await countsFor(c);
  for (const wrong of ["", "td c ενοικιάσεις", "TD c", "TD c Ενοικιάσεις!"]) {
    await assert.rejects(deleteTenant(c, { confirmName: wrong }), (e: unknown) => e instanceof TenantDeleteError && e.status === 400);
  }
  assert.deepEqual(await countsFor(c), before);
});

test("ζωντανή συνδρομή → 409 «Ακύρωσε πρώτα», τίποτα δεν σβήνεται", async () => {
  const d = await seedTenant("d");
  await db.tenant.update({ where: { id: d }, data: { billingStatus: "active", stripeSubId: `sub_${d}` } });
  const before = await countsFor(d);
  await assert.rejects(deleteTenant(d, { confirmName: "TD d Ενοικιάσεις" }), (e: unknown) => e instanceof TenantDeleteError && e.status === 409 && /Ακύρωσε πρώτα/.test(e.message));
  assert.deepEqual(await countsFor(d), before);
});

test("θέση ιδρυτή: μένει πιασμένη από προεπιλογή· με τικ ελευθερώνεται και ξαναδίνεται χωρίς σύγκρουση", async () => {
  await db.founderCode.create({ data: { codeHash: hashFounderCode("TDCODE001"), label: `${P}code`, maxClaims: 10 } });
  const prog0 = (await db.foundingProgram.findUniqueOrThrow({ where: { id: "founding" } })).claimedCount;
  const e = await seedTenant("e", { founderCode: "TDCODE001" });
  const f = await seedTenant("f", { founderCode: "TDCODE001" });
  const g = await seedTenant("g", { founderCode: "TDCODE001" });
  const slotF = (await db.founderClaim.findUniqueOrThrow({ where: { tenantId: f } })).slotNumber;
  assert.equal((await db.foundingProgram.findUniqueOrThrow({ where: { id: "founding" } })).claimedCount, prog0 + 3);

  // Χωρίς τικ: η θέση μένει (tenantId → NULL), ο μετρητής δεν αλλάζει.
  await deleteTenant(e, { confirmName: "TD e Ενοικιάσεις" });
  assert.equal((await db.foundingProgram.findUniqueOrThrow({ where: { id: "founding" } })).claimedCount, prog0 + 3);
  assert.equal(await db.founderClaim.count({ where: { tenantId: null, code: { label: `${P}code` } } }), 1);

  // Με τικ: η θέση της F ελευθερώνεται, μετρητής −1.
  await deleteTenant(f, { confirmName: "TD f Ενοικιάσεις", releaseFounderSlot: true });
  assert.equal((await db.foundingProgram.findUniqueOrThrow({ where: { id: "founding" } })).claimedCount, prog0 + 2);
  assert.equal(await db.founderClaim.count({ where: { slotNumber: slotF } }), 0);

  // Νέα διεκδίκηση: παίρνει την ελεύθερη θέση της F (όχι σύγκρουση με της G).
  const h = await seedTenant("h", { founderCode: "TDCODE001" });
  assert.equal((await db.founderClaim.findUniqueOrThrow({ where: { tenantId: h } })).slotNumber, slotF);
  assert.ok(await db.founderClaim.findUnique({ where: { tenantId: g } }));
});
