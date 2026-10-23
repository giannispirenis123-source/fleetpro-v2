// tests/e2e/user-delete.e2e.mjs — οριστική διαγραφή χρήστη (SQL 35), από άκρη σε άκρη.
// ΜΟΝΟ τοπικά (γράφει στη βάση με psql). ΔΕΝ τρέχει με `npm test`.
//
//   BASE_URL=http://localhost:3100 DATABASE_URL=postgresql://… \
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… SUPER_EMAIL=… SUPER_PASSWORD=… \
//   node --test tests/e2e/user-delete.e2e.mjs
//
// Η εταιρία του ADMIN_EMAIL πρέπει να έχει τουλάχιστον ένα όχημα.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const DB = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);
const PASS = "e2e-pass-1234";
const IP = `10.66.${Date.now() % 250}.${Date.now() % 200}`;
const sql = (q) => execFileSync("psql", [DB, "-At", "-c", q], { encoding: "utf8" }).trim();

/** Μικρός client με cookie. */
function client() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": IP, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
  return { call, login: (email, password) => call("POST", "/api/auth/login", { email, password }) };
}

const S = {};
const admin = client();
const superA = client();

before(async () => {
  assert.ok(DB, "DATABASE_URL");
  assert.equal((await admin.login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)).status, 200, "login Διαχειριστή");
  assert.equal((await superA.login(process.env.SUPER_EMAIL, process.env.SUPER_PASSWORD)).status, 200, "login Super Admin");
  S.tenantId = sql(`SELECT "tenantId" FROM users WHERE email = '${process.env.ADMIN_EMAIL}'`);
  S.adminId = sql(`SELECT id FROM users WHERE email = '${process.env.ADMIN_EMAIL}'`);
  S.vehicleId = sql(`SELECT id FROM vehicles WHERE "tenantId" = '${S.tenantId}' AND "isActive" LIMIT 1`);
  assert.ok(S.vehicleId, "χρειάζεται όχημα");
});

let seq = 0;
const mkUser = async (role, extra = {}) => {
  const n = ++seq;
  const email = `e2e-del-${role.toLowerCase()}-${n}-${RUN}@example.com`;
  const name = `E2E ${role} ${n} ${RUN}`;
  const r = await admin.call("POST", "/api/company-users", { name, email, password: PASS, role, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.data.user.id, email, name };
};

test("προετοιμασία: χρήστες + ιστορικό (κράτηση, συμβόλαιο, χειροκίνητη τιμή, activity log)", async () => {
  S.staff = await mkUser("STAFF");
  S.partner = await mkUser("PARTNER");
  S.staff2 = await mkUser("STAFF", { permissions: ["users.view", "users.delete", "users.edit"] });

  const staff = client();
  assert.equal((await staff.login(S.staff.email, PASS)).status, 200);
  const cust = await admin.call("POST", "/api/customers", { firstName: "Ε2Ε", lastName: `Πελάτης ${RUN}`, email: `c-${RUN}@example.com`, phone: "6900000000" });
  assert.equal(cust.status, 201, JSON.stringify(cust.json));
  S.customerId = cust.json.data.customer?.id ?? cust.json.data.id;
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const b = await staff.call("POST", "/api/bookings", {
    customerId: S.customerId, vehicleId: S.vehicleId, pickupDate: day(400 + (Date.now() % 300)), pickupTime: "10:00",
    returnDate: day(402 + (Date.now() % 300)), returnTime: "10:00", dailyRate: 10, totalDays: 2, subtotal: 20, total: 20,
  });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  S.bookingId = b.json.data.booking?.id ?? b.json.data.id;
  const c = await staff.call("POST", "/api/contracts", { bookingId: S.bookingId });
  assert.ok([200, 201].includes(c.status), JSON.stringify(c.json));
  S.contractId = c.json.data.contract?.id ?? c.json.data.id;
  sql(`UPDATE bookings SET "partnerId" = '${S.partner.id}' WHERE id = '${S.bookingId}'`);
  sql(`UPDATE contracts SET snapshot = jsonb_set(snapshot, '{priceOverride}', '{"manualRental": 30, "userId": "${S.staff.id}", "userName": "${S.staff.name}", "at": "2026-10-23T10:00:00Z"}'::jsonb) WHERE id = '${S.contractId}'`);
  sql(`INSERT INTO activity_logs (id, "tenantId", "userId", action, entity, "entityId", "createdAt") VALUES ('e2e-log-${RUN}', '${S.tenantId}', '${S.staff.id}', 'booking.confirmed', 'Booking', '${S.bookingId}', now())`);
  assert.equal(sql(`SELECT "createdByName" FROM contracts WHERE id = '${S.contractId}'`), S.staff.name);
  assert.match(sql(`SELECT "searchText" FROM contracts WHERE id = '${S.contractId}'`), new RegExp(RUN));
});

test("Staff με users.delete και Partner → 403", async () => {
  const s2 = client();
  assert.equal((await s2.login(S.staff2.email, PASS)).status, 200);
  assert.equal((await s2.call("DELETE", `/api/users/${S.partner.id}`)).status, 403);
  const p = client();
  assert.equal((await p.login(S.partner.email, PASS)).status, 200);
  assert.equal((await p.call("DELETE", `/api/users/${S.staff.id}`)).status, 403);
  assert.equal(sql(`SELECT count(*) FROM users WHERE id IN ('${S.partner.id}', '${S.staff.id}')`), "2");
});

test("όχι ο εαυτός του → 403", async () => {
  assert.equal((await admin.call("DELETE", `/api/users/${S.adminId}`)).status, 403);
});

test("χρήστης άλλης εταιρίας → 404, τίποτα δεν σβήνεται", async () => {
  const r = await superA.call("POST", "/api/tenants", {
    name: `E2E Άλλη ${RUN}`, slug: `e2e-other-${RUN}`, email: `other-${RUN}@example.com`,
    adminName: "Other Admin", adminEmail: `other-admin-${RUN}@example.com`, adminPassword: PASS,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const otherId = sql(`SELECT id FROM users WHERE email = 'other-admin-${RUN}@example.com'`);
  assert.equal((await admin.call("DELETE", `/api/users/${otherId}`)).status, 404);
  assert.equal((await admin.call("DELETE", `/api/users/does-not-exist-${RUN}`)).status, 404);
  assert.equal(sql(`SELECT count(*) FROM users WHERE id = '${otherId}'`), "1");
});

test("Διαχειριστής διαγράφει Staff και Partner: ιστορικό μένει, κανένα όνομα, email ελεύθερο", async () => {
  const before = sql(`SELECT (SELECT count(*) FROM bookings WHERE "tenantId"='${S.tenantId}') || '|' || (SELECT count(*) FROM contracts WHERE "tenantId"='${S.tenantId}') || '|' || (SELECT count(*) FROM activity_logs WHERE "tenantId"='${S.tenantId}')`);
  assert.equal((await admin.call("DELETE", `/api/users/${S.staff.id}`)).status, 200);
  assert.equal((await admin.call("DELETE", `/api/users/${S.partner.id}`)).status, 200);
  assert.equal(sql(`SELECT count(*) FROM users WHERE id IN ('${S.staff.id}', '${S.partner.id}')`), "0");

  // Ιστορικό: ίδιες γραμμές
  const after = sql(`SELECT (SELECT count(*) FROM bookings WHERE "tenantId"='${S.tenantId}') || '|' || (SELECT count(*) FROM contracts WHERE "tenantId"='${S.tenantId}') || '|' || (SELECT count(*) FROM activity_logs WHERE "tenantId"='${S.tenantId}')`);
  assert.equal(after, before);
  assert.equal(sql(`SELECT coalesce("createdById",'∅') || '|' || "createdByDeleted" || '|' || coalesce("partnerId",'∅') || '|' || "partnerDeleted" FROM bookings WHERE id = '${S.bookingId}'`), "∅|true|∅|true");
  assert.equal(sql(`SELECT coalesce("createdById",'∅') || '|' || coalesce("createdByName",'∅') || '|' || "createdByDeleted" FROM contracts WHERE id = '${S.contractId}'`), "∅|∅|true");
  assert.equal(sql(`SELECT coalesce("userId",'∅') FROM activity_logs WHERE id = 'e2e-log-${RUN}'`), "∅");
  const snap = sql(`SELECT snapshot->'priceOverride' FROM contracts WHERE id = '${S.contractId}'`);
  assert.doesNotMatch(snap, new RegExp(`${S.staff.id}|E2E STAFF`));
  assert.match(snap, /"userDeleted": true/);
  assert.doesNotMatch(sql(`SELECT "searchText" FROM contracts WHERE id = '${S.contractId}'`), /E2E STAFF/i);

  // Κανένα ίχνος σε API: κράτηση, ιστορικό απόφασης, συμβόλαιο, λίστες χρηστών
  const all = JSON.stringify([
    (await admin.call("GET", `/api/bookings?page=1`)).json,
    (await admin.call("GET", `/api/bookings/${S.bookingId}/decision`)).json,
    (await admin.call("GET", `/api/contracts/${S.contractId}`)).json,
    (await admin.call("GET", `/api/contracts`)).json,
    (await admin.call("GET", `/api/company-users`)).json,
    (await superA.call("GET", `/api/users?tenantId=${S.tenantId}&limit=100`)).json,
  ]);
  for (const leak of [S.staff.name, S.staff.email, S.partner.name, S.partner.email]) assert.equal(all.includes(leak), false, `ίχνος: ${leak}`);
  const booking = (await admin.call("GET", `/api/bookings?page=1`)).json.data.items.find((x) => x.id === S.bookingId);
  assert.equal(booking.createdByDeleted, true);
  assert.equal(booking.partnerDeleted, true);
  const contract = (await admin.call("GET", `/api/contracts/${S.contractId}`)).json.data.contract;
  assert.equal(contract.createdByName, "Διαγραμμένος χρήστης / Deleted user");
  const hist = (await admin.call("GET", `/api/bookings/${S.bookingId}/decision`)).json.data.history;
  assert.ok(hist.some((h) => h.byDeleted === true && h.by === null));

  // Το email ελευθερώθηκε
  const again = await admin.call("POST", "/api/company-users", { name: "Ξανά", email: S.staff.email, password: PASS, role: "STAFF" });
  assert.equal(again.status, 201, JSON.stringify(again.json));
});

test("δεύτερος Διαχειριστής διαγράφεται (ο αιτών μένει ενεργός)", async () => {
  const a2 = await mkUser("COMPANY_ADMIN");
  assert.equal((await admin.call("DELETE", `/api/users/${a2.id}`)).status, 200);
  assert.equal(sql(`SELECT count(*) FROM users WHERE "tenantId" = '${S.tenantId}' AND role = 'COMPANY_ADMIN' AND "isActive"`), "1");
});
