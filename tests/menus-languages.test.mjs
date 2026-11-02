// tests/menus-languages.test.mjs — κεντρικός πίνακας γλωσσών, κοινό μενού
// («Είσοδος», «Γλώσσα») σε site και dashboard, ίδιοι μηχανισμοί γλώσσας με πριν.

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

const L = await import("../src/lib/i18n/languages.ts");
const { LOCALES, isLocale, normalizeLocale } = await import("../src/lib/i18n/locale.ts");
const { STOREFRONT_LANGUAGES, storefrontDictionary, languageName } = await import("../src/lib/storefront/i18n.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("ΕΝΑ κεντρικό σημείο γλωσσών: κωδικός + όνομα στη δική της γλώσσα, μόνο οι υπάρχουσες", () => {
  assert.deepEqual(L.LANGUAGES.map((l) => [l.code, l.name]), [["el", "Ελληνικά"], ["en", "English"]]);
  assert.equal(L.languageName("el"), "Ελληνικά");
  assert.equal(L.languageName("en"), "English");
  assert.equal(L.languageName("xx"), "XX");
  // Dashboard και site διαβάζουν από εκεί.
  assert.deepEqual([...LOCALES], ["el", "en"]);
  assert.deepEqual([...STOREFRONT_LANGUAGES], ["el", "en"]);
  assert.equal(languageName, L.languageName);
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(normalizeLocale("fr"), "el");
  // Κανένα όνομα γλώσσας σκληρά γραμμένο στα λεξικά του site ή στα κουμπιά.
  assert.doesNotMatch(read("src/lib/storefront/i18n.ts"), /langName:/);
  for (const f of ["src/app/(dashboard)/dashboard/storefront/page.tsx", "src/app/(dashboard)/dashboard/onboarding/page.tsx"]) {
    assert.match(read(f), /languageName\(code\)/, f);
  }
  assert.match(read("src/lib/i18n/locale.ts"), /export const LOCALES: readonly Locale\[\] = LANGUAGE_CODES;/);
});

test("κοινό MenuButton: aria, Escape, κλικ έξω, πληκτρολόγιο, ✓ στο τρέχον", () => {
  const m = read("src/components/menu/MenuButton.tsx");
  assert.match(m, /aria-haspopup="menu"/);
  assert.match(m, /aria-expanded=\{open\}/);
  assert.match(m, /aria-controls=\{open \? menuId : undefined\}/);
  assert.match(m, /role="menu"/);
  assert.match(m, /role: radio \? "menuitemradio" : "menuitem"/);
  assert.match(m, /"aria-checked": radio \? it\.checked : undefined/);
  assert.match(m, /e\.key === "Escape"[\s\S]*?e\.stopPropagation\(\)[\s\S]*?close\(true\)/);
  assert.match(m, /document\.addEventListener\("mousedown", onDown\)/);
  for (const k of ["ArrowDown", "ArrowUp", "Home", "End", "Tab"]) assert.match(m, new RegExp(`e\\.key === "${k}"`), k);
  assert.match(m, /\{radio \? \(it\.checked \? "✓" : ""\) : null\}/);
  // Ουδέτερα χρώματα, δεν βγαίνει από την οθόνη.
  const css = read("src/components/menu/menu-button.css");
  assert.match(css, /max-width: min\(260px, calc\(100vw - 24px\)\)/);
  assert.doesNotMatch(css, /--sf-brand|--primary\b/);
});

test("site: «Γλώσσα» αντικαθιστά τα ξεχωριστά κουμπιά· ίδιος μηχανισμός (URL της γλώσσας)", () => {
  const v = read("src/components/storefront/StorefrontViews.tsx");
  assert.doesNotMatch(v, /className="sf-langs"/);
  assert.match(v, /<LanguageMenu\s+current=\{lang\}\s+codes=\{supportedLanguages\}\s+buttonLabel=\{d\.language\}/);
  assert.match(v, /hrefs=\{Object\.fromEntries\(supportedLanguages\.map\(\(code\) => \[code, langHref\(code\)\]\)\)\}/);
  assert.equal(storefrontDictionary("el").language, "Γλώσσα");
  assert.equal(storefrontDictionary("en").language, "Language");
  // Σειρά: «Είσοδος» αριστερά από τη «Γλώσσα».
  assert.ok(v.indexOf("<HeaderStaffMenu {...ctx} />") < v.indexOf("<LanguageMenu"));
});

test("dashboard: ίδιο κουτί «Γλώσσα» στο μενού λογαριασμού και στη σελίδα λογαριασμού, ίδια αποθήκευση", () => {
  for (const f of ["src/components/account/AccountMenu.tsx", "src/app/(dashboard)/dashboard/account/AccountClient.tsx"]) {
    const s = read(f);
    assert.match(s, /<LanguageMenu/, f);
    assert.match(s, /codes=\{LOCALES\}/, f);
    assert.match(s, /onSelect=\{\(code\) => isLocale\(code\) && changeLocale\(code\)\}/, f);
    assert.doesNotMatch(s, /dash-lang-btn/, f);
  }
  assert.match(read("src/components/account/useAccountActions.ts"), /fetch\("\/api\/users\/me\/locale"/);
  // Το dashboard έχει λεξικά και για τις δύο γλώσσες.
  assert.match(read("src/lib/i18n/index.ts"), /const DICTIONARIES: Record<Locale, Dictionary> = \{ el, en \};/);
});
