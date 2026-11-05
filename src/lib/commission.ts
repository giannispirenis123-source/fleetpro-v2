// src/lib/commission.ts
// Η προμήθεια του συνεργάτη.
//
// Υπολογίζεται ΠΑΝΤΑ από το τρέχον ποσοστό του συνεργάτη — δεν
// «παγώνει» πάνω στην κράτηση. Αν ο διαχειριστής αλλάξει το ποσοστό, τα
// σύνολα ενημερώνονται μόνα τους, χωρίς να πειραχτεί καμία κράτηση.
//
// Δεν εισάγει Prisma: φορτώνεται και σε client component.

import { round2 } from "./pricing";

/**
 * Οι ρυθμίσεις προμήθειας ενός χρήστη: το ποσοστό και οι τρεις
 * ΑΝΕΞΑΡΤΗΤΟΙ διακόπτες για το πάνω σε τι υπολογίζεται.
 */
export interface CommissionSettings {
  rate: number;
  onRental: boolean;
  onExtras: boolean;
  onInsurance: boolean;
}

export const NO_COMMISSION: CommissionSettings = {
  rate: 0,
  onRental: true,
  onExtras: false,
  onInsurance: false,
};

/**
 * Οι ρυθμίσεις προμήθειας από τη γραμμή του χρήστη (users.commission*).
 * Χωρίς ποσοστό → null (καμία προμήθεια). ΜΙΑ μετατροπή για όλους: τη σύνοψη
 * των κρατήσεων, τα «Οικονομικά» του συνεργάτη και τις «Προμήθειες συνεργατών».
 */
export function commissionSettingsOf(row: {
  commissionRate: unknown;
  commissionOnRental?: boolean | null;
  commissionOnExtras?: boolean | null;
  commissionOnInsurance?: boolean | null;
} | null | undefined): CommissionSettings | null {
  const rate = Number(row?.commissionRate ?? 0);
  return rate > 0
    ? {
        rate,
        onRental: row?.commissionOnRental ?? true,
        onExtras: row?.commissionOnExtras ?? false,
        onInsurance: row?.commissionOnInsurance ?? false,
      }
    : null;
}

/** Τα καθαρά συστατικά μιας κράτησης, πριν από έκπτωση και στρογγυλοποίηση. */
export interface CommissionParts {
  subtotal: number;
  extrasTotal: number;
  insuranceCost: number;
}

/**
 * Πάνω σε τι υπολογίζεται η προμήθεια.
 *
 * Μπαίνουν ΜΟΝΟ όσα συστατικά έχουν ανοιχτό διακόπτη, και πάντα στην
 * καθαρή τους μορφή: χωρίς έκπτωση και χωρίς στρογγυλοποίηση. Δύο
 * υπάλληλοι με το ίδιο ποσοστό πρέπει να αμείβονται το ίδιο για την ίδια
 * ενοικίαση, ανεξάρτητα από το τι έκπτωση δόθηκε στον πελάτη.
 */
export function commissionBase(
  parts: CommissionParts,
  s: CommissionSettings
): number {
  const sum =
    (s.onRental ? Math.max(0, parts.subtotal) : 0) +
    (s.onExtras ? Math.max(0, parts.extrasTotal) : 0) +
    (s.onInsurance ? Math.max(0, parts.insuranceCost) : 0);

  return round2(sum);
}

/** Η προμήθεια μιας κράτησης για τις συγκεκριμένες ρυθμίσεις. */
export function commissionFor(
  parts: CommissionParts,
  s: CommissionSettings
): number {
  if (s.rate <= 0) return 0;
  return round2(commissionBase(parts, s) * (Math.max(0, s.rate) / 100));
}

/** Απλή εκδοχή, όταν η βάση είναι ήδη υπολογισμένη. */
export function commissionOf(base: number, ratePercent: number): number {
  const rate = Math.max(0, ratePercent);
  return round2(Math.max(0, base) * (rate / 100));
}

/** Σύντομη περιγραφή της βάσης, για το UI: «Ενοίκιο + Πρόσθετα». */
export function baseLabels(s: CommissionSettings): ("rental" | "extras" | "insurance")[] {
  const out: ("rental" | "extras" | "insurance")[] = [];
  if (s.onRental) out.push("rental");
  if (s.onExtras) out.push("extras");
  if (s.onInsurance) out.push("insurance");
  return out;
}

/**
 * Μια ακυρωμένη κράτηση δεν φέρνει προμήθεια.
 *
 * Όλες οι υπόλοιπες μετράνε — και οι εκκρεμείς. Ο συνεργάτης έφερε τη
 * δουλειά· το αν θα ολοκληρωθεί δεν εξαρτάται από εκείνον, και μια
 * σύνοψη που δείχνει μόνο τις ολοκληρωμένες θα ήταν άδεια όλη τη σεζόν.
 * Η ακύρωση είναι το μόνο σαφές «δεν έγινε».
 */
export const countsForCommission = (status: string): boolean =>
  status !== "CANCELLED";

export interface CommissionSummary {
  /** Πλήθος κρατήσεων που μετράνε. */
  bookings: number;
  base: number;
  commission: number;
}

/** Άθροισμα προμήθειας για μια λίστα κρατήσεων. */
export function summarize(
  bookings: (CommissionParts & { status: string; partnerCode?: { cents: number } | null })[],
  s: CommissionSettings
): CommissionSummary {
  const counted = bookings.filter((b) => countsForCommission(b.status));

  return {
    bookings: counted.length,
    base: round2(counted.reduce((a, b) => a + commissionBase(b, s), 0)),
    // Κρατήσεις με κωδικό συνεργάτη: μειωμένη προμήθεια (bookingCommission).
    commission: round2(counted.reduce((a, b) => a + bookingCommission(b, s, b.partnerCode), 0)),
  };
}

/* ─────────────────────────────────────────────
   Κωδικοί έκπτωσης συνεργάτη
   ───────────────────────────────────────────── */

/**
 * Το μέγιστο ποσοστό έκπτωσης που μπορεί να δώσει ένας συνεργάτης σε δικό
 * του κωδικό: ΤΟ ΠΟΣΟΣΤΟ ΠΡΟΜΗΘΕΙΑΣ του (ίσο επιτρέπεται). Χωρίς προμήθεια → 0.
 */
export const maxPartnerDiscountPercent = (s: CommissionSettings): number => Math.max(0, s.rate);

export type PartnerDiscountCheck =
  | { ok: true }
  | { ok: false; reason: "over_commission"; max: number }
  | { ok: false; reason: "fixed_amount" };

/**
 * Επιτρέπεται ο κωδικός για συνεργάτη;
 * · Ποσοστό: ≤ προμήθεια (ίσο επιτρέπεται).
 * · Σταθερό ποσό (€): ΟΧΙ — δεν συγκρίνεται με ποσοστό χωρίς την αξία της
 *   κράτησης, οπότε ο συνεργάτης φτιάχνει μόνο ποσοστιαίους κωδικούς.
 */
export function checkPartnerDiscount(type: string, value: number, s: CommissionSettings): PartnerDiscountCheck {
  if (type !== "PERCENTAGE") return { ok: false, reason: "fixed_amount" };
  const max = maxPartnerDiscountPercent(s);
  // Μικρή ανοχή για δεκαδικά (π.χ. 20 έναντι 20.00 από Decimal).
  return value <= max + 1e-9 ? { ok: true } : { ok: false, reason: "over_commission", max };
}

/* ─────────────────────────────────────────────
   Κωδικός συνεργάτη στο δημόσιο site (μειωμένη προμήθεια)
   ───────────────────────────────────────────── */

/**
 * Ο κωδικός συνεργάτη ΟΠΩΣ εφαρμόστηκε σε μια κράτηση του site — ζει στο
 * bookings."priceQuote".manualDiscount.partner (ΜΑΖΙ με το ποσό της έκπτωσης,
 * ώστε να μην μπορούν ποτέ να «ξεκολλήσουν»). Οι διακόπτες βάσης είναι αυτοί
 * που ίσχυαν τη στιγμή της κράτησης (για τον ξαναϋπολογισμό του ποσού).
 */
export interface PartnerCodeShare {
  /** Ο συνεργάτης στον οποίο ανήκει ο κωδικός. */
  userId: string;
  /** Το ποσοστό του κωδικού (π.χ. 5). */
  percent: number;
  onRental: boolean;
  onExtras: boolean;
  onInsurance: boolean;
  /** Ανώτατο ποσό έκπτωσης του κωδικού (€) — null/undefined = χωρίς. */
  maxDiscount?: number | null;
}

/** Η έκπτωση του κωδικού συνεργάτη + το ποσό της (cents) — από το priceQuote. */
export interface PartnerCodeOnBooking extends PartnerCodeShare {
  code: string;
  /** Η έκπτωση που πήρε ο πελάτης (cents) — την «πληρώνει» ο συνεργάτης. */
  cents: number;
}

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Ο κωδικός συνεργάτη από ένα αποθηκευμένο priceQuote — null = κανένας. */
export function partnerCodeOf(priceQuote: unknown): PartnerCodeOnBooking | null {
  if (!priceQuote || typeof priceQuote !== "object" || Array.isArray(priceQuote)) return null;
  const q = priceQuote as { version?: unknown; manualDiscount?: unknown };
  if (q.version !== 1 || !q.manualDiscount || typeof q.manualDiscount !== "object") return null;
  const m = q.manualDiscount as { cents?: unknown; code?: unknown; partner?: unknown };
  const p = m.partner as Partial<Record<keyof PartnerCodeShare, unknown>> | null | undefined;
  if (!p || typeof p !== "object") return null;
  const cents = typeof m.cents === "number" && Number.isFinite(m.cents) ? Math.max(0, Math.round(m.cents)) : 0;
  const percent = typeof p.percent === "number" && Number.isFinite(p.percent) ? p.percent : 0;
  if (typeof m.code !== "string" || !m.code || typeof p.userId !== "string" || percent <= 0) return null;
  return {
    code: m.code,
    cents,
    userId: p.userId,
    percent,
    onRental: bool(p.onRental, true),
    onExtras: bool(p.onExtras, false),
    onInsurance: bool(p.onInsurance, false),
    maxDiscount: typeof p.maxDiscount === "number" && Number.isFinite(p.maxDiscount) && p.maxDiscount >= 0 ? p.maxDiscount : null,
  };
}

/**
 * Η έκπτωση (cents) ενός κωδικού συνεργάτη: ΠΟΣΟΣΤΟ του κωδικού πάνω στην
 * ΙΔΙΑ βάση με την προμήθεια (commissionBase — καθαρά συστατικά, μόνο όσα
 * έχουν ανοιχτό διακόπτη), ΠΡΟΣ ΤΑ ΚΑΤΩ σε ακέραιο € (το σύνολο του site
 * μένει ακέραιο και η έκπτωση δεν ξεπερνά ποτέ το ποσοστό × βάση), με
 * προαιρετικό ανώτατο ποσό (€) και ποτέ πάνω από το σύνολο.
 */
export function partnerCodeDiscountCents(
  parts: CommissionParts,
  share: Pick<PartnerCodeShare, "percent" | "onRental" | "onExtras" | "onInsurance" | "maxDiscount">,
  totalCents: number
): number {
  const maxDiscountEuros = share.maxDiscount ?? null;
  const baseCents = Math.round(
    commissionBase(parts, { rate: share.percent, onRental: share.onRental, onExtras: share.onExtras, onInsurance: share.onInsurance }) * 100
  );
  const pct = Math.max(0, share.percent);
  let euros = Math.floor((baseCents * pct) / 10_000 + 1e-9);
  if (maxDiscountEuros !== null && Number.isFinite(maxDiscountEuros) && maxDiscountEuros >= 0) {
    euros = Math.min(euros, Math.floor(maxDiscountEuros + 1e-9));
  }
  const cents = Math.max(0, euros * 100);
  return Math.min(cents, Math.max(0, Math.floor(totalCents / 100) * 100));
}

/**
 * Η προμήθεια μιας κράτησης — με ή χωρίς κωδικό συνεργάτη.
 *
 * Με κωδικό: η κανονική προμήθεια (τρέχον ποσοστό, ίδια βάση) ΜΕΙΟΝ την
 * έκπτωση που πήρε ο πελάτης. Έτσι η εταιρία παίρνει ΑΚΡΙΒΩΣ ό,τι θα έπαιρνε
 * χωρίς κωδικό (σύνολο − έκπτωση − (προμήθεια − έκπτωση) = σύνολο − προμήθεια).
 * Η έκπτωση είναι ≤ ποσοστό κωδικού × βάση, άρα η προμήθεια είναι ≥ (ποσοστό −
 * ποσοστό κωδικού) × βάση· π.χ. 20% − 5% → 15% (ακριβώς, όταν η έκπτωση βγαίνει
 * ακέραια). Ποτέ αρνητική.
 */
export function bookingCommission(
  parts: CommissionParts,
  s: CommissionSettings,
  code: Pick<PartnerCodeOnBooking, "cents"> | null | undefined
): number {
  const full = commissionFor(parts, s);
  if (!code) return full;
  return round2(Math.max(0, full - code.cents / 100));
}

/** Το ονομαστικό ποσοστό μετά τον κωδικό (για εμφάνιση: «15%»). */
export const reducedRate = (s: CommissionSettings, code: Pick<PartnerCodeShare, "percent"> | null | undefined): number =>
  code ? Math.max(0, round2(s.rate - code.percent)) : s.rate;
