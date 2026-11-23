// tests/super-admin-settings.test.mjs — Super Admin → Ρυθμίσεις: οι κάρτες
// «Στοιχεία Πλατφόρμας», «Τιμές Συνδρομών», «Δοκιμαστική Περίοδος» ΔΕΝ
// αποθηκεύουν πουθενά → μόνο προβολή, χωρίς κουμπί «Αποθήκευση».

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/app/(super-admin)/super-admin/page.tsx", import.meta.url), "utf8");
const a = src.indexOf("function PlatformSettingsView()");
const view = src.slice(a, src.indexOf("function MyPasswordCard()", a));

test("οι τρεις κάρτες υπάρχουν, είναι μόνο προβολή και δεν έχουν κουμπί", () => {
  for (const id of ["sa-readonly-platform", "sa-readonly-prices", "sa-readonly-trial"]) assert.ok(view.includes(`data-testid="${id}"`), id);
  for (const h of ["Στοιχεία Πλατφόρμας", "Τιμές Συνδρομών", "Δοκιμαστική Περίοδος"]) assert.ok(view.includes(h), h);
  assert.doesNotMatch(view, /<button/, "κανένα κουμπί που δεν κάνει τίποτα");
  assert.doesNotMatch(view, /defaultValue=/, "κανένα πεδίο που μοιάζει επεξεργάσιμο");
  const inputs = view.match(/<input[\s\S]*?\/>/g) ?? [];
  assert.equal(inputs.length, 6);
  for (const i of inputs) assert.match(i, /readOnly/, i);
  assert.equal((view.match(/μόνο προβολή/g) ?? []).length, 3);
  assert.match(view, /Οι τιμές ορίζονται στο Stripe/);
  assert.match(view, /Οι τιμές ορίζονται στον κώδικα/);
});

test("η δοκιμαστική περίοδος δείχνει τις ΠΡΑΓΜΑΤΙΚΕΣ τιμές του κώδικα (όχι σκληρογραμμένες)", () => {
  assert.match(view, /value=\{CARD_TRIAL_DAYS\}/);
  assert.match(view, /value=\{FOUNDER_TRIAL_DAYS\}/);
  assert.match(src, /import \{ CARD_TRIAL_DAYS, FOUNDER_TRIAL_DAYS \} from "@\/lib\/billing\/core";/);
  // Η αλλαγή του δικού μου κωδικού μένει λειτουργική.
  assert.match(view, /<MyPasswordCard \/>/);
});
