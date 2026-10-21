// tests/storefront-search-layout.test.mjs
// Διάταξη της φόρμας αναζήτησης του δημόσιου site: παραλαβή (τοποθεσία |
// ημερομηνία | ώρα), επιστροφή (ίδια), ηλικία + κουμπί. Ένα ημερολόγιο
// διαστήματος με δύο πεδία. Στατικοί έλεγχοι — η λογική ελέγχεται στο
// public-search.test.mjs και δεν αλλάζει.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const box = read("src/components/storefront/SearchBox.tsx");
const picker = read("src/components/storefront/DateRangePicker.tsx");
const css = read("src/components/storefront/storefront.css");

const ORDER = ["sf-search-pl", "sf-search-fd", "sf-search-ft", "sf-search-dl", "sf-search-td", "sf-search-tt", "sf-search-age", "sf-search-go"];

test("σειρά πεδίων (DOM = ανάγνωση/Tab): παραλαβή → επιστροφή → ηλικία → αναζήτηση", () => {
  const pos = ORDER.map((c) => box.indexOf(`sf-field ${c}`) >= 0 ? box.indexOf(`sf-field ${c}`) : box.indexOf(c));
  pos.forEach((p, i) => assert.ok(p > 0, `λείπει ${ORDER[i]}`));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, "λάθος σειρά πεδίων");
  // Οι ημερομηνίες μπαίνουν στη γραμμή τους: start στην παραλαβή, end στην επιστροφή.
  assert.ok(box.indexOf("{dates.start}") < box.indexOf("sf-field sf-search-ft"));
  assert.ok(box.indexOf("{dates.end}") > box.indexOf("sf-field sf-search-dl"));
});

test("desktop: 3 ίσες στήλες, 3 γραμμές (παραλαβή / επιστροφή / ηλικία + κουμπί)", () => {
  const desk = css.slice(css.indexOf("@media (min-width: 900px)", css.indexOf("/* ── Κουτί αναζήτησης ── */")));
  assert.match(desk, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(desk, /"pl fd ft"\s*"dl td tt"\s*"age go \."/);
});

test("κινητό: τοποθεσία, ημερομηνία + ώρα δίπλα δίπλα, ίδια για επιστροφή, ηλικία, κουμπί πλήρους πλάτους", () => {
  assert.match(css, /"pl pl"\s*"fd ft"\s*"dl dl"\s*"td tt"\s*"age age"\s*"go go"/);
  assert.match(css, /\.sf-search-go \{ grid-area: go; width: 100%/);
});

test("ένα ημερολόγιο, δύο πεδία: ίδιο dialog από όποιο πεδίο, εστίαση πίσω σε αυτό", () => {
  assert.equal((picker.match(/role="dialog"/g) ?? []).length, 1, "ΕΝΑ ημερολόγιο");
  assert.match(picker, /`\$\{idPrefix\}-dates`/);
  assert.match(picker, /`\$\{idPrefix\}-dates-end`/);
  assert.match(picker, /onClick=\{\(e\) => openPicker\(e\.currentTarget\)\}/);
  assert.match(picker, /triggerRef\.current\?\.focus\(\)/);
  // Η εγγραφή των ημερομηνιών μένει μία: onChange(start, end).
  assert.match(picker, /onChange\(s, e\);/);
  assert.match(box, /onChange=\{\(s, e\) => \{\s*setFromDate\(s\);\s*setToDate\(e\);/);
});

test("η λογική της αναζήτησης δεν άλλαξε: ίδιος έλεγχος, ίδιο URL, σφάλμα → στο αντίστοιχο πεδίο", () => {
  assert.match(box, /validateCriteria\(c, rules, new Date\(\)\)/);
  assert.match(box, /router\.push\(`\$\{action\}\?\$\{criteriaToQuery\(c\)\}`\)/);
  assert.match(box, /first === "from" \? "dates" : first === "to" \? "dates-end" : first/);
});
