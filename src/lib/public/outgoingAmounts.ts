// src/lib/public/outgoingAmounts.ts
// Έλεγχος ποσών ΠΡΙΝ φύγει οτιδήποτε προς τον πελάτη (email, WhatsApp/mailto,
// PDF). Καθαρή λογική, χωρίς imports πέρα από το money.ts — server, client, tests.
//
// Αφορμή: σε άλλο site ένα email έδειξε «180180» αντί για «180» (το ποσό
// τυπώθηκε δύο φορές μέσα στο κείμενο). Εδώ, από το ΕΤΟΙΜΟ κείμενο:
//   (α) κάθε ποσό με € ανήκει στο επιτρεπτό σύνολο (από το ΑΠΟΘΗΚΕΥΜΕΝΟ quote),
//   (β) το σύνολο εμφανίζεται ΑΚΡΙΒΩΣ μία φορά, στη γραμμή συνόλου,
//   (γ) κανένα ποσό δεν είναι «κολλημένο» με τον εαυτό του (180180, 180 €180 €),
//   (δ) το σύνολο είναι μέσα σε λογικά όρια (0 … MAX_TOTAL_CENTS).
// Αποτυχία → ΔΕΝ στέλνεται· ο καλών καταγράφει ΜΟΝΟ τον κωδικό (όχι ποσά/στοιχεία).

import { MAX_TOTAL_CENTS, formatMoney } from "./money";

export const AMOUNT_CHECK_CODES = ["bad_total", "total_bounds", "unknown_amount", "total_count", "repeated_digits"] as const;
export type AmountCheckCode = (typeof AMOUNT_CHECK_CODES)[number];
export type AmountCheck = { ok: true } | { ok: false; code: AmountCheckCode };

export interface AmountSpec {
  /** Το αποθηκευμένο σύνολο (priceQuote.totalCents / total τιμολογίου). */
  totalCents: number;
  /** Κάθε άλλο ποσό που ΕΠΙΤΡΕΠΕΤΑΙ να εμφανιστεί (γραμμές, ΦΠΑ, εγγύηση, πληρωμένα…). */
  otherCents?: number[];
  /**
   * Η ΑΚΡΙΒΗΣ γραμμή συνόλου όπως πρέπει να εμφανίζεται (π.χ. «Σύνολο: 180 €»).
   * null = το κείμενο δεν έχει γραμμή συνόλου (π.χ. ακύρωση) → το σύνολο δεν απαιτείται.
   */
  totalLine: string | null;
  maxCents?: number;
}

/* ── Εξαγωγή ποσών από κείμενο ── */

const NBSP = /[  ]/g;

/**
 * Όλα τα ποσά με € του κειμένου, σε cents. Αναγνωρίζει και τις δύο μορφές
 * του formatMoney: «1.180,50 €» (el) και «€1,180.50» (en), με «−»/«-».
 * Αριθμός ΧΩΡΙΣ € (τηλέφωνα, κωδικοί, ημερομηνίες) δεν είναι ποσό.
 */
export function extractAmounts(text: string, opts: { requireDecimals?: boolean } = {}): number[] {
  const t = text.replace(NBSP, " ");
  const out: { at: number; cents: number }[] = [];
  // el: αριθμός ΠΡΙΝ το €  (ο αριθμός μπορεί να είναι και «180180» — πιάνεται ολόκληρος)
  const el = /([−-])?(\d[\d.]*)(?:,(\d{1,2}))?\s?€/g;
  for (let m; (m = el.exec(t)); ) {
    const intDigits = m[2].replace(/\./g, "");
    if (!/^\d+$/.test(intDigits) || (opts.requireDecimals && !m[3])) continue;
    const cents = Number(intDigits) * 100 + (m[3] ? Number(m[3].padEnd(2, "0")) : 0);
    out.push({ at: m.index, cents: m[1] ? -cents : cents });
  }
  // en: € ΠΡΙΝ τον αριθμό
  const en = /([−-])?€\s?(\d[\d,]*)(?:\.(\d{1,2}))?/g;
  for (let m; (m = en.exec(t)); ) {
    const intDigits = m[2].replace(/,/g, "");
    if (!/^\d+$/.test(intDigits) || (opts.requireDecimals && !m[3])) continue;
    // Μην ξαναμετρήσεις το € ενός el ποσού («180 €» ακολουθούμενο από αριθμό χωρίς κενό).
    const cents = Number(intDigits) * 100 + (m[3] ? Number(m[3].padEnd(2, "0")) : 0);
    out.push({ at: m.index, cents: m[1] ? -cents : cents });
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.cents);
}

/** HTML email → απλό κείμενο για τον ΙΔΙΟ έλεγχο (όχι για εμφάνιση). */
export function htmlToCheckText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Οι μορφές με τις οποίες μπορεί να εμφανιστεί ένα ποσό (για τον έλεγχο «κολλημένου»). */
function renderings(cents: number): string[] {
  const forms = new Set<string>();
  for (const lang of ["el", "en"]) {
    for (const decimals of ["auto", "always"] as const) {
      forms.add(formatMoney(cents, lang, { decimals, plainSpace: true }));
    }
  }
  return [...forms];
}

const digitsOf = (s: string) => s.replace(/\D/g, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ο έλεγχος. `texts` = όλες οι μορφές του ίδιου μηνύματος (text, html ως
 * κείμενο, θέμα): ΚΑΘΕ μία πρέπει να περνά.
 */
export function verifyOutgoingAmounts(texts: string | string[], spec: AmountSpec): AmountCheck {
  const max = spec.maxCents ?? MAX_TOTAL_CENTS;
  const total = spec.totalCents;
  // (δ) σύνολο: αριθμός, ακέραιο, μέσα στα όρια.
  if (typeof total !== "number" || !Number.isFinite(total) || !Number.isInteger(Math.round(total))) return { ok: false, code: "bad_total" };
  if (total < 0 || total > max) return { ok: false, code: "total_bounds" };

  const allowed = new Set<number>([Math.round(total), ...(spec.otherCents ?? []).filter(Number.isFinite).map((c) => Math.round(c))]);
  for (const raw of Array.isArray(texts) ? texts : [texts]) {
    const text = raw.replace(NBSP, " ");

    // (γ) «κολλημένο» ποσό.
    if (hasRepeatedAmount(text, allowed)) return { ok: false, code: "repeated_digits" };

    // (α) κάθε ποσό με € ανήκει στο επιτρεπτό σύνολο.
    const amounts = extractAmounts(text);
    if (amounts.some((a) => !allowed.has(Math.abs(a)) && !allowed.has(a))) return { ok: false, code: "unknown_amount" };

    // (β) η γραμμή συνόλου ΑΚΡΙΒΩΣ μία φορά, με το σωστό ποσό.
    if (spec.totalLine !== null) {
      const line = spec.totalLine.replace(NBSP, " ");
      const count = text.split(line).length - 1;
      if (count !== 1) return { ok: false, code: "total_count" };
      // Η γραμμή συνόλου δεν έχει άλλο ποσό κολλημένο δίπλα της (τελεία στο
      // τέλος πρότασης επιτρέπεται· «.50» / «,50» / ψηφίο / € όχι).
      const lineRe = new RegExp(`${escapeRe(line)}(?!\\d|€|[.,]\\d)`);
      if (!lineRe.test(text)) return { ok: false, code: "repeated_digits" };
    }
  }
  return { ok: true };
}

/**
 * (γ) Το ίδιο ποσό δύο φορές στη σειρά, σε οποιαδήποτε από τις μορφές του, με
 * ή χωρίς κενό/€ ανάμεσα: «180180», «180 €180 €», «€180€180», «180,00 €180,00 €».
 */
export function hasRepeatedAmount(rawText: string, allowed: Iterable<number>): boolean {
  const text = rawText.replace(NBSP, " ");
  for (const c of allowed) {
    const d = digitsOf(formatMoney(c, "el", { plainSpace: true }));
    // Μόνο από 3 ψηφία και πάνω: «11»/«22» είναι συχνά ημερομηνίες (11 Δεκ) —
    // τα μικρά ποσά τα πιάνουν ο έλεγχος με € και το (α) («1818 €» δεν επιτρέπεται).
    if (d.length >= 3) {
      // Ολόκληρος αριθμός (όχι κομμάτι τηλεφώνου/κωδικού) που είναι d+d.
      const token = new RegExp(`(?<![\\d.,])${escapeRe(d)}${escapeRe(d)}(?![\\d])`);
      if (token.test(digitsOnlyNumbers(text))) return true;
    }
    // Το ΑΚΕΡΑΙΟ μέρος δύο φορές, με ή χωρίς δεκαδικά: «180180,00 €» / «€180180.50».
    const intDigits = String(Math.floor(Math.abs(Math.round(c)) / 100));
    if (intDigits.length >= 3) {
      const glued = new RegExp(`(?<!\\d)${intDigits}${intDigits}(\\d{2})?(?!\\d)`);
      if (glued.test(digitsOnlyNumbers(text))) return true;
    }
    for (const f of renderings(c)) {
      const twice = new RegExp(`${escapeRe(f)}\\s?${escapeRe(f)}`);
      if (twice.test(text)) return true;
    }
  }
  return false;
}

/**
 * Κάθε «αριθμητική ακολουθία» του κειμένου (ψηφία με τελείες/κόμματα ανάμεσα)
 * γίνεται σκέτα ψηφία, χωρισμένα με κενό — ώστε το «1.180,501.180,50» να
 * ελέγχεται ως «118050118050».
 */
function digitsOnlyNumbers(text: string): string {
  return text.replace(/\d[\d.,]*\d|\d/g, (m) => m.replace(/[.,]/g, ""));
}

/** Μήνυμα για το UI (ΕΛ — όπως όλα τα μηνύματα των API). */
export const AMOUNT_BLOCKED_MESSAGE = "Η αποστολή μπλοκαρίστηκε: ασυμφωνία ποσού.";

/* ── Έγγραφα (PDF συμβολαίου / τιμολογίου) ── */

/** Ποσό σε έγγραφο που δεν περνά τον έλεγχο → το PDF ΔΕΝ βγαίνει. */
export class AmountIntegrityError extends Error {
  readonly code: AmountCheckCode;
  constructor(code: AmountCheckCode) {
    super(`amount:${code}`);
    this.name = "AmountIntegrityError";
    this.code = code;
  }
}

/**
 * «Λογιστήριο» ποσών ενός εγγράφου: ΚΑΘΕ ποσό που τυπώνεται περνά από το
 * fmt() — καταγράφεται (cents) και μορφοποιείται από το ΕΝΑ formatMoney.
 */
export function amountLedger(lang = "el") {
  const expected: number[] = [];
  return {
    expected,
    /** € (Decimal/number) → «1.234,50 €» — και καταγραφή. */
    fmt(euros: number): string {
      const cents = Math.round(Number(euros) * 100);
      expected.push(cents);
      return formatMoney(cents, lang, { decimals: "always", plainSpace: true });
    },
  };
}

/**
 * Καταγράφει το κείμενο που ζωγραφίζεται σε μια σελίδα PDF, ΜΟΝΟ όσο είναι
 * ενεργή η «ζώνη ποσών» (χρεώσεις / γραμμές / σύνολα). Τα ελεύθερα κείμενα της
 * εταιρίας (όροι, σημειώσεις) δεν ελέγχονται — μπορεί να γράφουν «εγγύηση 300 €».
 */
export function trackDrawnText<P extends { drawText: (text: string, options?: never) => unknown }>(
  page: P,
  sink: string[],
  active: () => boolean
): P {
  const original = page.drawText.bind(page) as (text: string, options?: unknown) => unknown;
  (page as { drawText: (text: string, options?: unknown) => unknown }).drawText = (text: string, options?: unknown) => {
    if (active()) sink.push(text);
    return original(text, options);
  };
  return page;
}

/**
 * Έλεγχος εγγράφου: τα ποσά που ΖΩΓΡΑΦΙΣΤΗΚΑΝ (εξαγωγή από το κείμενο των
 * σελίδων) πρέπει να είναι ΑΚΡΙΒΩΣ αυτά που πέρασαν από το λογιστήριο — ίδιο
 * πλήθος ανά ποσό (καμία διπλή εκτύπωση, κανένα κολλημένο ή άγνωστο ποσό) —
 * και το σύνολο του εγγράφου ίσο με το αποθηκευμένο και μέσα σε όρια.
 */
export function verifyDrawnAmounts(
  drawn: string[],
  expected: number[],
  totals: { storedCents: number; renderedCents: number; maxCents?: number }
): AmountCheck {
  const max = totals.maxCents ?? MAX_TOTAL_CENTS;
  if (!Number.isFinite(totals.storedCents) || !Number.isFinite(totals.renderedCents)) return { ok: false, code: "bad_total" };
  if (totals.storedCents < 0 || totals.storedCents > max) return { ok: false, code: "total_bounds" };
  if (Math.round(totals.storedCents) !== Math.round(totals.renderedCents)) return { ok: false, code: "unknown_amount" };
  // «Κολλημένο» ποσό ΜΕΣΑ σε ένα κείμενο (κάθε drawText είναι ξεχωριστό κελί:
  // «× 30,00 €» και δίπλα «30,00 €» είναι δύο κελιά, όχι διπλή εκτύπωση).
  const allowed = [totals.storedCents, ...expected];
  if (drawn.some((t) => hasRepeatedAmount(t, allowed))) return { ok: false, code: "repeated_digits" };
  // Ενωμένα με κενό: η αναδίπλωση γραμμής μπορεί να χωρίσει «145,16» από «€».
  const text = drawn.join(" ");
  const count = (xs: number[]) => xs.reduce((m, x) => m.set(Math.abs(x), (m.get(Math.abs(x)) ?? 0) + 1), new Map<number, number>());
  const want = count(expected);
  // Μόνο ποσά με 2 δεκαδικά (μορφή του λογιστηρίου): ένα «5 €» μέσα σε όνομα
  // προσθέτου δεν μετρά· ένα «180180,00 €» μετρά (και αποτυγχάνει).
  const got = count(extractAmounts(text, { requireDecimals: true }));
  if (want.size !== got.size) return { ok: false, code: "unknown_amount" };
  for (const [cents, n] of want) {
    if (got.get(cents) !== n) return { ok: false, code: cents === Math.abs(Math.round(totals.storedCents)) ? "total_count" : "unknown_amount" };
  }
  return { ok: true };
}
