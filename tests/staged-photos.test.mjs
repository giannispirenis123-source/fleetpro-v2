// tests/staged-photos.test.mjs
// Φωτογραφίες σε νέο συμβόλαιο πριν την πρώτη αποθήκευση
// (src/lib/stagedPhotos.ts): αντιστοίχιση σε driverIds, όρια, ανέβασμα
// μετά την αποθήκευση με μερική αποτυχία, τίποτα στο δίκτυο πριν.
// Τρέχει με `npm test` (node:test).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_LIMITS,
  pruneForDrivers,
  roomFor,
  stagedFor,
  uploadAll,
  uploadRequest,
} from "../src/lib/stagedPhotos.ts";

let n = 0;
const photo = (target, extra = {}) => ({
  key: `k${++n}`,
  target,
  blob: { size: 100 },
  previewUrl: `blob:local/${n}`,
  takenAt: "2026-10-05T10:00:00.000Z",
  note: "",
  status: "staged",
  message: "",
  ...extra,
});
const lic = (driverId) => ({ kind: "license", driverId });
const PICKUP = { kind: "damage", group: "PICKUP" };
const RETURN = { kind: "damage", group: "RETURN" };
const none = { damages: 0, licensesOf: () => 0 };

/* ── Αντιστοίχιση σε driverIds ── */

test("δίπλωμα → endpoint licenses με το driverId του client", () => {
  const p = photo(lic("a1b2c3d4e5f60718"));
  assert.deepEqual(uploadRequest("cmabc123", p), {
    url: "/api/contracts/cmabc123/licenses",
    fields: { driverId: "a1b2c3d4e5f60718", takenAt: "2026-10-05T10:00:00.000Z" },
  });
});

test("ζημιά → endpoint photos με ομάδα και σημείωση", () => {
  const p = photo(RETURN, { note: "  γρατζουνιά  " });
  assert.deepEqual(uploadRequest("c1", p), {
    url: "/api/contracts/c1/photos",
    fields: { group: "RETURN", takenAt: "2026-10-05T10:00:00.000Z", note: "γρατζουνιά" },
  });
  assert.equal("note" in uploadRequest("c1", photo(PICKUP)).fields, false);
});

test("κάθε οδηγός παίρνει ΜΟΝΟ τις δικές του φωτογραφίες", () => {
  const list = [photo(lic("d1")), photo(lic("d2")), photo(lic("d1")), photo(PICKUP)];
  assert.equal(stagedFor(list, lic("d1")).length, 2);
  assert.equal(stagedFor(list, lic("d2")).length, 1);
  assert.equal(stagedFor(list, PICKUP).length, 1);
  assert.equal(stagedFor(list, RETURN).length, 0);
});

test("οδηγός που αφαιρέθηκε πριν την αποθήκευση: οι φωτογραφίες του δεν ανεβαίνουν", () => {
  const list = [photo(lic("d1")), photo(lic("gone")), photo(PICKUP)];
  const kept = pruneForDrivers(list, ["d1", "d2"]);
  assert.deepEqual(kept.map((p) => p.target), [lic("d1"), PICKUP]);
});

/* ── Όρια (ίδια με τον server) ── */

test("δίπλωμα: έως 4 ανά οδηγό, μετρώντας staged + ανεβασμένες", () => {
  assert.equal(STAGE_LIMITS.licensePerDriver, 4);
  const list = [photo(lic("d1")), photo(lic("d1")), photo(lic("d2"))];
  assert.equal(roomFor(lic("d1"), list, none), 2);
  assert.equal(roomFor(lic("d2"), list, none), 3);
  assert.equal(roomFor(lic("d1"), list, { damages: 0, licensesOf: (id) => (id === "d1" ? 2 : 0) }), 0);
});

test("ζημιές: 40 σύνολο για παραλαβή + παράδοση", () => {
  assert.equal(STAGE_LIMITS.damages, 40);
  const list = [photo(PICKUP), photo(RETURN), photo(lic("d1"))];
  assert.equal(roomFor(PICKUP, list, none), 38);
  assert.equal(roomFor(RETURN, list, { damages: 38, licensesOf: () => 0 }), 0);
});

/* ── Τίποτα στο δίκτυο πριν την αποθήκευση ── */

test("η προσθήκη/αφαίρεση staged δεν καλεί ποτέ ανέβασμα", async () => {
  let calls = 0;
  const upload = async () => {
    calls++;
    return { ok: true, result: {} };
  };
  // Όλη η ζωή μιας staged φωτογραφίας πριν την αποθήκευση: μόνο πίνακες στη μνήμη.
  let list = [photo(PICKUP), photo(lic("d1"))];
  list = list.filter((p) => p.target.kind !== "license");
  list = pruneForDrivers(list, []);
  roomFor(PICKUP, list, none);
  assert.equal(calls, 0);
  // Μόνο με ρητό uploadAll (μετά την αποθήκευση, με contractId) ξεκινά δίκτυο.
  await uploadAll(list, upload);
  assert.equal(calls, 1);
});

/* ── Μετά την αποθήκευση: μερική αποτυχία ── */

test("μία αποτυχία δεν σταματά τις υπόλοιπες· σωστή πρόοδος", async () => {
  const items = [photo(PICKUP), photo(lic("d1")), photo(RETURN), photo(lic("d2"))];
  const seen = [];
  const progress = [];
  const result = await uploadAll(
    items,
    async (p) => {
      seen.push(p.key);
      return p === items[1]
        ? { ok: false, message: "Η φωτογραφία είναι πολύ μεγάλη" }
        : { ok: true, result: { id: `s-${p.key}` } };
    },
    (done, total) => progress.push(`${done}/${total}`)
  );
  assert.deepEqual(seen, items.map((p) => p.key)); // με τη σειρά, όλες
  assert.deepEqual(progress, ["1/4", "2/4", "3/4", "4/4"]);
  assert.deepEqual(result.failed, [{ key: items[1].key, message: "Η φωτογραφία είναι πολύ μεγάλη" }]);
  assert.equal(result.uploaded.length, 3);
});

test("εξαίρεση δικτύου = αποτυχία της συγκεκριμένης, όχι όλων", async () => {
  const items = [photo(PICKUP), photo(PICKUP)];
  const result = await uploadAll(items, async (p) => {
    if (p === items[0]) throw new Error("network");
    return { ok: true, result: 1 };
  });
  assert.equal(result.failed.length, 1);
  assert.equal(result.uploaded.length, 1);
});

test("«Ξανά»: ξανά-ανέβασμα μόνο όσων απέτυχαν", async () => {
  const items = [photo(PICKUP), photo(RETURN)];
  let fail = true;
  const upload = async (p) => (p === items[1] && fail ? { ok: false, message: "x" } : { ok: true, result: 1 });
  const first = await uploadAll(items, upload);
  fail = false;
  const retry = await uploadAll(items.filter((p) => first.failed.some((f) => f.key === p.key)), upload);
  assert.equal(retry.failed.length, 0);
  assert.deepEqual(retry.uploaded.map((u) => u.key), [items[1].key]);
});
