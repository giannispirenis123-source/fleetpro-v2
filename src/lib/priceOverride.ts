// src/lib/priceOverride.ts
// Χειροκίνητη τιμή ΕΝΟΙΚΙΟΥ συμβολαίου — καθαρή λογική, χωρίς runtime
// imports (τη φορτώνουν server, client και τα tests).
//
//  · Ο χρήστης δίνει ΜΟΝΟ την τιμή του ΕΝΟΙΚΙΟΥ με ΦΠΑ (η βάση, χωρίς
//    πρόσθετα/ασφάλεια, > 0, 2 δεκαδικά) και προαιρετικό λόγο. Ο server
//    ελέγχει δικαίωμα (contracts.price) και κλείδωμα.
//  · Σύνολο = χειροκίνητο ενοίκιο + πρόσθετα + ασφάλεια − έκπτωση
//    (totalWithRental). Πρόσθετο που μπαίνει/βγαίνει αλλάζει αμέσως το
//    σύνολο. Οι γραμμές αθροίζουν ΑΚΡΙΒΩΣ στο σύνολο — καμία «Προσαρμογή».
//    Η roundUpTotal ΔΕΝ εφαρμόζεται. Η έκπτωση μένει όπως υπολογίστηκε.
//  · Το σύνολο γίνεται το total της κράτησης (ΕΝΑ σύνολο: κράτηση,
//    συμβόλαιο, τιμολόγιο). Οι γραμμές της κράτησης (και η προμήθεια)
//    μένουν υπολογισμένες.
//  · ΠΑΛΙΑ μορφή (έως 08/10/2026): `manualTotal` = χειροκίνητο ΤΕΛΙΚΟ
//    σύνολο. Μετατρέπεται σε ενοίκιο με τις γραμμές που ίσχυαν μαζί του
//    (manualRentalOf): ίδιο σύνολο σήμερα, και από εκεί και πέρα τα
//    πρόσθετα προστίθενται κανονικά.
//  · Το ιστορικό (υπολογισμένο, χειροκίνητο, ποιος, πότε, γιατί) ζει στο
//    snapshot του συμβολαίου (JSON) — χωρίς νέα στήλη.

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const PRICE_REASON_MAX = 200;
export const PRICE_MAX = 1_000_000;

/** Όπως αποθηκεύεται στο snapshot του συμβολαίου (`snapshot.priceOverride`). */
export interface PriceOverride {
  /** Η τιμή ΕΝΟΙΚΙΟΥ με ΦΠΑ που όρισε ο χρήστης. */
  manualRental?: number;
  /** ΠΑΛΙΑ μορφή: χειροκίνητο ΤΕΛΙΚΟ σύνολο (βλ. manualRentalOf). */
  manualTotal?: number;
  /** Το υπολογισμένο ενοίκιο τη στιγμή της αλλαγής (μόνο εσωτερικά). */
  computedRental?: number;
  /** ΠΑΛΙΑ μορφή: η υπολογισμένη τελική τιμή τη στιγμή της αλλαγής. */
  computedTotal?: number;
  /** ΠΑΛΙΑ μορφή: manualTotal − computedTotal. */
  diff?: number;
  userId?: string;
  userName?: string;
  /** ISO */
  at?: string;
  reason?: string;
}

/** Οι γραμμές της κράτησης (χωρίς ΦΠΑ-ανάλυση). */
export interface PriceParts {
  subtotal: number;
  extrasTotal: number;
  insuranceCost: number;
  discountAmount: number;
}

/** Το ακριβές άθροισμα των γραμμών. */
export const exactTotalOf = (b: PriceParts) =>
  round2(b.subtotal + b.extrasTotal + b.insuranceCost - b.discountAmount);

/** Η υπολογισμένη τιμή (με τη στρογγυλοποίηση της εταιρίας, αν ισχύει). */
export const computedTotalOf = (b: PriceParts, roundUpTotal: boolean) => {
  const exact = exactTotalOf(b);
  return roundUpTotal ? Math.ceil(exact) : exact;
};

/** Ό,τι μπαίνει πάνω στο ενοίκιο: πρόσθετα + ασφάλεια − έκπτωση. */
const restOf = (b: PriceParts) => round2(b.extrasTotal + b.insuranceCost - b.discountAmount);

/** Σύνολο με χειροκίνητο ενοίκιο: ενοίκιο + πρόσθετα + ασφάλεια − έκπτωση. */
export const totalWithRental = (b: PriceParts, rental: number) => round2(rental + restOf(b));

/**
 * Το χειροκίνητο ενοίκιο. Παλιά μορφή (τελικό σύνολο): ενοίκιο = σύνολο −
 * (πρόσθετα + ασφάλεια − έκπτωση) με τις γραμμές που ίσχυαν ΜΑΖΙ του
 * (`partsWithIt`: οι γραμμές της κράτησης ΠΡΙΝ από οποιαδήποτε νέα αλλαγή).
 */
export function manualRentalOf(p: PriceOverride | undefined, partsWithIt: PriceParts): number | undefined {
  if (!p) return undefined;
  if (p.manualRental !== undefined) return p.manualRental;
  if (p.manualTotal !== undefined) return round2(p.manualTotal - restOf(partsWithIt));
  return undefined;
}

/** Παλιά μορφή → νέα (για αποθήκευση): ίδιο σύνολο, ενοίκιο αντί για σύνολο. */
export function toRentalOverride(p: PriceOverride, partsWithIt: PriceParts): PriceOverride {
  const { manualTotal: _t, computedTotal: _c, diff: _d, ...rest } = p;
  return { ...rest, manualRental: manualRentalOf(p, partsWithIt) };
}

/** Για εμφάνιση: το ενοίκιο είναι το χειροκίνητο, το σύνολο = άθροισμα γραμμών. */
export const withManualRental = <T extends PriceParts>(b: T, rental: number) => ({
  ...b,
  subtotal: rental,
  total: totalWithRental(b, rental),
});

/** Αμυντική ανάγνωση από το Json. */
export function readPriceOverride(v: unknown): PriceOverride | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const str = (x: unknown) => (typeof x === "string" ? x : undefined);
  const positive = (x: unknown) => {
    const n = num(typeof x === "string" ? Number(x) : x);
    return n !== undefined && n > 0 ? n : undefined;
  };
  const manualRental = positive(o.manualRental);
  const manualTotal = manualRental === undefined ? positive(o.manualTotal) : undefined;
  if (manualRental === undefined && manualTotal === undefined) return undefined;
  return {
    ...(manualRental !== undefined ? { manualRental, computedRental: num(o.computedRental) } : { manualTotal }),
    computedTotal: num(o.computedTotal),
    diff: num(o.diff),
    userId: str(o.userId),
    userName: str(o.userName),
    at: str(o.at),
    reason: str(o.reason),
  };
}

/** Έγκυρο ποσό: > 0, έως 2 δεκαδικά, λογικό άνω όριο. */
export function validManualPrice(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isFinite(n) &&
    n > 0 &&
    n <= PRICE_MAX &&
    Math.abs(round2(n) - n) < 1e-9
  );
}

/** Από τον client: ΜΟΝΟ η τιμή ενοικίου + λόγος (ή null = επαναφορά). */
export type PriceRequest = { rental: number; reason?: string } | null;

export type PriceDecision =
  | { ok: true; total: number; override: PriceOverride | null }
  | { ok: false; status: 400 | 403 | 409; message: string };

const LOCK_MESSAGE: Record<string, string> = {
  signed: "Η τιμή δεν αλλάζει μετά την πρώτη υπογραφή",
  invoiced: "Η κράτηση έχει τιμολόγιο: η τιμή δεν αλλάζει",
  closed: "Η κράτηση έχει κλείσει: η τιμή δεν αλλάζει",
};

/**
 * Η απόφαση του server για μια αλλαγή τιμής. Από τον client λαμβάνεται
 * ΜΟΝΟ η τιμή ενοικίου και ο λόγος· όλα τα άλλα (σύνολο, υπολογισμένο
 * ενοίκιο, ποιος, πότε) τα βάζει ο server.
 *
 *  · `requested = null` → επαναφορά: total = η υπολογισμένη τιμή.
 *  · Δικαίωμα → 403. Κλείδωμα (υπογραφή / τιμολόγιο / κλειστή) → 409.
 */
export function decidePriceOverride(input: {
  requested: PriceRequest;
  canPrice: boolean;
  lock: "signed" | "invoiced" | "closed" | null;
  parts: PriceParts;
  roundUpTotal: boolean;
  actor: { userId: string; userName: string };
  now: Date;
}): PriceDecision {
  if (!input.canPrice) {
    return { ok: false, status: 403, message: "Δεν έχετε δικαίωμα αλλαγής τιμής" };
  }
  if (input.lock) return { ok: false, status: 409, message: LOCK_MESSAGE[input.lock] };

  if (input.requested === null) {
    return { ok: true, total: computedTotalOf(input.parts, input.roundUpTotal), override: null };
  }

  const { rental, reason } = input.requested;
  if (!validManualPrice(rental)) {
    return { ok: false, status: 400, message: "Η τιμή ενοικίου πρέπει να είναι ποσό > 0 με έως 2 δεκαδικά" };
  }
  const why = (reason ?? "").trim();
  if (why.length > PRICE_REASON_MAX) {
    return { ok: false, status: 400, message: `Ο λόγος έως ${PRICE_REASON_MAX} χαρακτήρες` };
  }
  // ΚΑΜΙΑ στρογγυλοποίηση: σύνολο = ενοίκιο + πρόσθετα + ασφάλεια − έκπτωση.
  const total = totalWithRental(input.parts, rental);
  if (!(total > 0)) {
    return { ok: false, status: 400, message: "Με αυτό το ενοίκιο το σύνολο βγαίνει μηδέν ή αρνητικό" };
  }
  return {
    ok: true,
    total,
    override: {
      manualRental: rental,
      computedRental: input.parts.subtotal,
      userId: input.actor.userId,
      userName: input.actor.userName,
      at: input.now.toISOString(),
      reason: why,
    },
  };
}

/**
 * Το χειροκίνητο ενοίκιο «δεν ακολουθεί» αλλαγές ημερομηνιών/οχήματος:
 * το υπολογισμένο ενοίκιο σήμερα διαφέρει από αυτό που ίσχυε όταν ορίστηκε.
 */
export const overrideIsStale = (p: PriceOverride | undefined, computedRentalNow: number) =>
  !!p && p.computedRental !== undefined && Math.abs(p.computedRental - computedRentalNow) > 0.004;
