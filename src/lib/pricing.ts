// src/lib/pricing.ts
// Ο υπολογισμός τιμής μιας κράτησης, σε ΕΝΑ σημείο.
//
// Το ίδιο αρχείο τρέχει και στη φόρμα (ζωντανή προεπισκόπηση) και στον
// server (η τιμή που όντως αποθηκεύεται). Δεν εισάγει Prisma ή db ώστε να
// μπορεί να φορτωθεί από client component.
//
// ΧΩΡΙΣ ΦΠΑ και χωρίς τιμολόγιο — αυτά ανήκουν στη σελίδα Τιμολογίων.

/** Στρογγυλοποίηση σε λεπτά. Τα ενδιάμεσα αθροίσματα στρογγυλεύονται
 *  ώστε οι γραμμές της ανάλυσης να αθροίζουν ακριβώς στο σύνολο. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export type ChargeType = "PER_DAY" | "ONE_OFF";
export type ExtraKind = "EXTRA" | "INSURANCE";

/** Τα στοιχεία ενός πρόσθετου που χρειάζεται ο υπολογισμός. */
export interface PricedExtraInput {
  id: string;
  name: string;
  price: number;
  chargeType: string;
  type: string;
}

/** Γραμμή ανάλυσης: το πρόσθετο μαζί με το ποσό που αναλογεί. */
export interface PricedExtraLine extends PricedExtraInput {
  lineTotal: number;
}

/**
 * NONE    — καμία έκπτωση
 * AMOUNT  — χειροκίνητο ποσό σε €
 * PERCENT — χειροκίνητο ποσοστό επί του (subtotal + extras + ασφάλεια)
 * CODE    — κωδικός· το ποσό το βγάζει ο έλεγχος του κωδικού
 */
export const DISCOUNT_MODES = ["NONE", "AMOUNT", "PERCENT", "CODE"] as const;
export type DiscountMode = (typeof DISCOUNT_MODES)[number];

export interface PriceInput {
  totalDays: number;
  dailyRate: number;
  /** Τα ΕΠΙΛΕΓΜΕΝΑ πρόσθετα, με την τιμή που ισχύει τη στιγμή του υπολογισμού. */
  extras: PricedExtraInput[];
  discountMode: DiscountMode;
  /** € όταν AMOUNT, % όταν PERCENT. Αγνοείται στις υπόλοιπες περιπτώσεις. */
  discountValue?: number;
  /** Το ποσό που επέστρεψε ο έλεγχος του κωδικού. Μόνο όταν CODE. */
  codeDiscountAmount?: number;
  /** Ρύθμιση εταιρίας: στρογγυλοποίηση ΜΟΝΟ του τελικού ποσού προς τα πάνω. */
  roundUpTotal?: boolean;
}

export interface PriceBreakdown {
  totalDays: number;
  dailyRate: number;
  subtotal: number;
  extrasTotal: number;
  insuranceCost: number;
  /** subtotal + extrasTotal + insuranceCost — η βάση της έκπτωσης. */
  beforeDiscount: number;
  discountAmount: number;
  /** Το ποσό πριν τη στρογγυλοποίηση — πάντα το ακριβές άθροισμα. */
  exactTotal: number;
  /** Πόσο πρόσθεσε η στρογγυλοποίηση· 0 όταν δεν εφαρμόστηκε ή δεν χρειάστηκε. */
  roundingAdjustment: number;
  total: number;
  lines: PricedExtraLine[];
}

/** PER_DAY → τιμή × ημέρες. ONE_OFF → τιμή μία φορά. */
export function lineTotal(
  price: number,
  chargeType: string,
  totalDays: number
): number {
  const days = Math.max(1, Math.floor(totalDays));
  return round2(chargeType === "PER_DAY" ? price * days : price);
}

export function computePrice(input: PriceInput): PriceBreakdown {
  const totalDays = Math.max(1, Math.floor(input.totalDays));
  const dailyRate = Math.max(0, input.dailyRate);

  const subtotal = round2(dailyRate * totalDays);

  const lines: PricedExtraLine[] = input.extras.map((e) => ({
    ...e,
    lineTotal: lineTotal(e.price, e.chargeType, totalDays),
  }));

  const sum = (kind: ExtraKind) =>
    round2(
      lines
        .filter((l) => l.type === kind)
        .reduce((acc, l) => acc + l.lineTotal, 0)
    );

  const extrasTotal = sum("EXTRA");
  const insuranceCost = sum("INSURANCE");
  const beforeDiscount = round2(subtotal + extrasTotal + insuranceCost);

  let discountAmount = 0;
  switch (input.discountMode) {
    case "AMOUNT":
      discountAmount = Math.max(0, input.discountValue ?? 0);
      break;
    case "PERCENT": {
      const pct = Math.min(100, Math.max(0, input.discountValue ?? 0));
      discountAmount = (beforeDiscount * pct) / 100;
      break;
    }
    case "CODE":
      discountAmount = Math.max(0, input.codeDiscountAmount ?? 0);
      break;
    default:
      discountAmount = 0;
  }

  // Η έκπτωση δεν ξεπερνά ποτέ το ποσό πριν από αυτήν, άρα το σύνολο
  // δεν γίνεται ποτέ αρνητικό.
  discountAmount = round2(Math.min(discountAmount, beforeDiscount));

  const exactTotal = round2(beforeDiscount - discountAmount);

  // Η στρογγυλοποίηση αγγίζει ΜΟΝΟ το τελικό ποσό, αφού έχουν υπολογιστεί
  // τα πάντα. Οι γραμμές παραπάνω μένουν ακριβείς — γι' αυτό κρατάμε και
  // το exactTotal και τη διαφορά, ώστε να μη «χάνονται» λεπτά αθόρυβα.
  const total = input.roundUpTotal ? Math.ceil(exactTotal) : exactTotal;

  return {
    totalDays,
    dailyRate,
    subtotal,
    extrasTotal,
    insuranceCost,
    beforeDiscount,
    discountAmount,
    exactTotal,
    roundingAdjustment: round2(total - exactTotal),
    total,
    lines,
  };
}

/* ─────────────────────────────────────────────
   Κατανομή της στρογγυλοποίησης στις εμφανιζόμενες γραμμές
   ───────────────────────────────────────────── */

/**
 * Τα ποσά όπως ΕΜΦΑΝΙΖΟΝΤΑΙ. Το αποθηκευμένο total δεν αλλάζει ποτέ —
 * αλλάζει μόνο ο τρόπος που «σπάει» σε γραμμές, ώστε να μη χρειάζεται
 * ξεχωριστή γραμμή «Στρογγυλοποίηση».
 */
export interface DisplayBreakdown {
  subtotal: number;
  extrasTotal: number;
  insuranceCost: number;
  discountAmount: number;
  total: number;
  /** true όταν το subtotal εμφανίζεται αυξημένο σε σχέση με ημέρες × τιμή. */
  subtotalAdjusted: boolean;
}

/**
 * Απορροφά τη στρογγυλοποίηση μέσα στις υπάρχουσες γραμμές:
 *
 *  1. Πρώτα μειώνει την εμφανιζόμενη έκπτωση, όσο φτάνει.
 *  2. Ό,τι περισσεύει το προσθέτει στο εμφανιζόμενο subtotal.
 *
 * Το άθροισμα των εμφανιζόμενων γραμμών ισούται ΠΑΝΤΑ με το total:
 *   (subtotal + υπόλοιπο) + extras + ασφάλεια − (έκπτωση − απορροφημένο)
 *   = ακριβές + υπόλοιπο + απορροφημένο = ακριβές + στρογγυλοποίηση = total
 */
export function toDisplayBreakdown(b: {
  subtotal: number;
  extrasTotal: number;
  insuranceCost: number;
  discountAmount: number;
  total: number;
}): DisplayBreakdown {
  const exact = round2(
    b.subtotal + b.extrasTotal + b.insuranceCost - b.discountAmount
  );
  const rounding = round2(b.total - exact);

  // Χωρίς στρογγυλοποίηση (ή με σβηστή ρύθμιση) τίποτα δεν αλλάζει.
  if (rounding <= 0) {
    return {
      subtotal: b.subtotal,
      extrasTotal: b.extrasTotal,
      insuranceCost: b.insuranceCost,
      discountAmount: b.discountAmount,
      total: b.total,
      subtotalAdjusted: false,
    };
  }

  const absorbedByDiscount = Math.min(b.discountAmount, rounding);
  const remainder = round2(rounding - absorbedByDiscount);

  return {
    subtotal: round2(b.subtotal + remainder),
    extrasTotal: b.extrasTotal,
    insuranceCost: b.insuranceCost,
    discountAmount: round2(b.discountAmount - absorbedByDiscount),
    total: b.total,
    subtotalAdjusted: remainder > 0,
  };
}

/* ─── Snapshot των πρόσθετων στο Booking.extras (Json) ───
   Κρατάμε τιμή και χρέωση όπως ίσχυαν τη στιγμή της κράτησης, ώστε μια
   μελλοντική αλλαγή τιμής να μην αναδρομικά αλλοιώνει παλιές κρατήσεις. */

export const EXTRAS_SNAPSHOT_VERSION = 1 as const;

export interface ExtrasSnapshot {
  version: number;
  items: PricedExtraLine[];
}

export function buildExtrasSnapshot(lines: PricedExtraLine[]): ExtrasSnapshot {
  return {
    version: EXTRAS_SNAPSHOT_VERSION,
    items: lines.map((l) => ({
      id: l.id,
      name: l.name,
      price: l.price,
      chargeType: l.chargeType,
      type: l.type,
      lineTotal: l.lineTotal,
    })),
  };
}

/** Διαβάζει το Json της βάσης αμυντικά: παλιές κρατήσεις έχουν {} εκεί. */
export function readExtrasSnapshot(value: unknown): PricedExtraLine[] {
  if (!value || typeof value !== "object") return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") return [];
    return [
      {
        id: o.id,
        name: o.name,
        price: Number(o.price) || 0,
        chargeType: String(o.chargeType ?? "ONE_OFF"),
        type: String(o.type ?? "EXTRA"),
        lineTotal: Number(o.lineTotal) || 0,
      },
    ];
  });
}
