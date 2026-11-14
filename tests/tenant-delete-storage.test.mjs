// tests/tenant-delete-storage.test.mjs — διαγραφή εταιρίας: σβήνονται και τα
// αρχεία της στο Supabase Storage, ΜΟΝΟ κάτω από "<tenantId>/".

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

const { collectTenantPaths, removeTenantFiles } = await import("../src/lib/storageCleanup.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** Ψεύτικο bucket: λίστα πλήρων διαδρομών· list με σημασιολογία ΦΑΚΕΛΟΥ όπως το Supabase. */
function bucket(paths) {
  const store = new Set(paths);
  const calls = [];
  return {
    store,
    calls,
    list: async (folder, offset, limit) => {
      calls.push(folder);
      const prefix = `${folder}/`;
      const names = new Map();
      for (const p of [...store].sort()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const [first, ...more] = rest.split("/");
        if (!names.has(first)) names.set(first, more.length ? null : `id-${p}`);
      }
      return [...names].map(([name, id]) => ({ name, id })).slice(offset, offset + limit);
    },
    remove: async (list) => {
      for (const p of list) store.delete(p);
      return true;
    },
  };
}

const A = ["tA/c1/pickup/a.jpg", "tA/c1/return/b.jpg", "tA/c1/licenses/d1-front-x.jpg", "tA/damages/dm1/z.jpg", "tA/branding/logo-1.png"];
const OTHERS = ["tAB/branding/logo.png", "tB/c9/pickup/q.jpg", "tB/damages/dm2/w.jpg", "xtA/branding/logo.png"];

test("σβήνονται ΟΛΑ τα αρχεία της εταιρίας (διπλώματα, ζημιές, συμβόλαια, λογότυπο) και ΚΑΝΕΝΑ άλλης", async () => {
  const b = bucket([...A, ...OTHERS]);
  assert.deepEqual((await collectTenantPaths("tA", b.list)).sort(), [...A].sort());
  const r = await removeTenantFiles("tA", b);
  assert.deepEqual(r, { removed: 5, failed: 0 });
  assert.deepEqual([...b.store].sort(), [...OTHERS].sort(), "οι άλλες εταιρίες άθικτες (και με παρόμοιο id: tAB, xtA)");
  assert.ok(b.calls.every((f) => f === "tA" || f.startsWith("tA/")), "ζητήθηκαν ΜΟΝΟ φάκελοι της εταιρίας");
});

test("άκυρο/επικίνδυνο id ή ονόματα με «/», «..» → τίποτα δεν σβήνεται εκτός φακέλου", async () => {
  const b = bucket([...A, ...OTHERS]);
  for (const id of ["", "..", "tA/..", "tA/../tB", "*", "t A", "%"]) {
    assert.deepEqual(await removeTenantFiles(id, b), { removed: 0, failed: 0 }, JSON.stringify(id));
  }
  assert.equal(b.store.size, A.length + OTHERS.length);
  // Storage που «απαντά» με ξένες/πονηρές διαδρομές: αγνοούνται, δεν σβήνεται τίποτα εκτός tA/.
  const removed = [];
  const evil = {
    list: async (folder, offset) =>
      offset > 0 || folder !== "tA" ? [] : [{ name: "../tB/c9/pickup/q.jpg", id: "1" }, { name: "tB/x.jpg", id: "2" }, { name: "..", id: null }, { name: "ok.jpg", id: "3" }],
    remove: async (list) => (removed.push(...list), true),
  };
  await removeTenantFiles("tA", evil);
  assert.deepEqual(removed, ["tA/ok.jpg"]);
});

test("σελιδοποίηση και αποτυχία διαγραφής: μετρώνται, δεν πετούν σφάλμα", async () => {
  const many = Array.from({ length: 250 }, (_, i) => `tA/damages/dm1/${String(i).padStart(3, "0")}.jpg`);
  const b = bucket(many);
  assert.equal((await collectTenantPaths("tA", b.list)).length, 250);
  let n = 0;
  const flaky = { list: b.list, remove: async () => ++n !== 2 };
  assert.deepEqual(await removeTenantFiles("tA", flaky), { removed: 150, failed: 100 });
  const boom = { list: b.list, remove: async () => { throw new Error("net"); } };
  assert.deepEqual(await removeTenantFiles("tA", boom), { removed: 0, failed: 250 });
});

test("σύνδεση: tenantDelete καλεί το Storage ΜΕΤΑ το commit, με όριο χρόνου· το prefix έχει πάντα «/» στο τέλος", () => {
  const del = read("src/lib/tenantDelete.ts");
  assert.match(del, /withTimeout\(removeTenantStorage\(result\.id\), STORAGE_TIMEOUT_MS, "storage"\)\.catch\(/);
  assert.ok(del.indexOf("removeTenantStorage(result.id)") > del.indexOf('DELETE FROM "tenants"'), "μετά τη transaction");
  const st = read("src/lib/storage.ts");
  assert.match(st, /prefix: `\$\{folder\.replace\(\/\\\/\+\$\/, ""\)\}\/`/);
  assert.match(del, /removeTenantFiles\(tenantId, \{ list: listFolder, remove: removeStrict \}\)/);
  assert.doesNotMatch(st, /^import /m, "το storage.ts μένει χωρίς imports");
  // Στα logs μόνο πλήθη — ποτέ διαδρομές αρχείων.
  assert.doesNotMatch(del, /console\.\w+\([^)]*paths/);
});
