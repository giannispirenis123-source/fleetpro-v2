// src/lib/storefront/lang.ts
// Η γλώσσα του δημόσιου site για το <html lang> — καθαρή λογική.
// Το middleware τη βάζει σε header (από το /s/<slug>/<lang>/…) και το root
// layout τη διαβάζει· οτιδήποτε άλλο → "el" (η γλώσσα του dashboard).

export const SITE_LANG_HEADER = "x-fleetpro-site-lang";

export const htmlLang = (value: string | null | undefined): string =>
  typeof value === "string" && /^[a-z]{2}$/.test(value) ? value : "el";
