// src/lib/priceOverride.ts
// Χειροκίνητη (τελική) τιμή συμβολαίου — καθαρή λογική, χωρίς runtime
// imports (τη φορτώνουν server, client και τα tests).
//
//  · Ο χρήστης δίνει ΜΟΝΟ το τελικό σύνολο ΜΕ ΦΠΑ (> 0, 2 δεκαδικά) και
//    προαιρετικό λόγο. Ο server ελέγχει δικαίωμα (contracts.price) και
//    κλείδωμα, και υπολογίζει ο ίδιος τη διαφορά από την υπολογισμένη τιμή.
//  · Η χειροκίνητη τιμή γίνεται το total της κράτησης (ΕΝΑ σύνολο παντού).
//    Η roundUpTotal ΔΕΝ εφαρμόζεται πάνω της. Οι γραμμές (ενοίκιο, πρόσθετα,
//    ασφάλεια, έκπτωση) μένουν όπως υπολογίστηκαν· η «Προσαρμογή τιμής» είναι
//    η διαφορά ώστε να αθροίζουν ακριβώς στο σύνολο.
//  · Το ιστορικό (υπολογισμένη, χειροκίνητη, ποιος, πότε, γιατί) ζει στο
//    snapshot του συμβολαίου (JSON) — χωρίς νέα στήλη.

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const PRICE_REASON_MAX = 200;
export const PRICE_MAX = 1_000_000;

/** Όπως αποθηκεύεται στο snapshot του συμβολαίου (`snapshot.priceOverride`). */
export interface PriceOverride {
  /** Η τελική τιμή με ΦΠΑ που όρισε ο χρήστης. */
  manualTotal: number;
  /** Η υπολογισμένη τιμή τη στιγμή της αλλαγής (μόνο εσωτερικά). */
  computedTotal?: number;
  /** manualTotal − computedTotal (μόνο εσωτερικά). */
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

/** «Προσαρμογή τιμής»: ό,τι λείπει/περισσεύει ώστε οι γραμμές = σύνολο. */
export const adjustmentOf = (b: PriceParts, manualTotal: number) =>
  round2(manualTotal - exactTotalOf(b));

/** Αμυντική ανάγνωση από το Json. */
export function readPriceOverride(v: unknown): PriceOverride | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const manualTotal = Number(o.manualTotal);
  if (!Number.isFinite(manualTotal) || manualTotal <= 0) return undefined;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const str = (x: unknown) => (typeof x === "string" ? x : undefined);
  return {
    manualTotal,
    computedTotal: num(o.computedTotal),
    diff: num(o.diff),
    userId: str(o.userId),
    userName: str(o.userName),
    at: str(o.at),
    reason: str(o.reason),
  };
}

/** Μόνο για τη σελίδα πελάτη: η τελική τιμή, χωρίς ποιος/γιατί/διαφορά. */
export const publicPriceOverride = (p: PriceOverride | undefined): PriceOverride | undefined =>
  p ? { manualTotal: p.manualTotal } : undefined;

/** Έγκυρο ποσό: > 0, έως 2 δεκαδικά, λογικό άνω όριο. */
export function validManualTotal(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isFinite(n) &&
    n > 0 &&
    n <= PRICE_MAX &&
    Math.abs(round2(n) - n) < 1e-9
  );
}

export type PriceRequest = { total: number; reason?: string } | null;

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
 * ΜΟΝΟ το τελικό ποσό και ο λόγος· όλα τα άλλα (διαφορά, υπολογισμένη
 * τιμή, ποιος, πότε) τα βάζει ο server.
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

  const computedTotal = computedTotalOf(input.parts, input.roundUpTotal);
  if (input.requested === null) return { ok: true, total: computedTotal, override: null };

  const { total, reason } = input.requested;
  if (!validManualTotal(total)) {
    return { ok: false, status: 400, message: "Η τιμή πρέπει να είναι ποσό > 0 με έως 2 δεκαδικά" };
  }
  const why = (reason ?? "").trim();
  if (why.length > PRICE_REASON_MAX) {
    return { ok: false, status: 400, message: `Ο λόγος έως ${PRICE_REASON_MAX} χαρακτήρες` };
  }
  return {
    ok: true,
    // ΚΑΜΙΑ στρογγυλοποίηση πάνω στη χειροκίνητη τιμή.
    total,
    override: {
      manualTotal: total,
      computedTotal,
      diff: round2(total - computedTotal),
      userId: input.actor.userId,
      userName: input.actor.userName,
      at: input.now.toISOString(),
      reason: why,
    },
  };
}

/**
 * Η χειροκίνητη τιμή «δεν ακολουθεί τις αλλαγές»: η υπολογισμένη τιμή
 * σήμερα διαφέρει από αυτή που ίσχυε όταν ορίστηκε.
 */
export const overrideIsStale = (p: PriceOverride | undefined, computedNow: number) =>
  !!p && p.computedTotal !== undefined && Math.abs(p.computedTotal - computedNow) > 0.004;
