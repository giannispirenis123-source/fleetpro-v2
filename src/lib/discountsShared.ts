// src/lib/discountsShared.ts
// Κοινός τύπος και σταθερές εκπτώσεων — τα φορτώνει και client component,
// οπότε ΔΕΝ εισάγει Prisma ή db. Η server λογική ζει στο discounts.ts.

export const DISCOUNT_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"] as const;
export type DiscountTypeValue = (typeof DISCOUNT_TYPES)[number];

/** Το μοντέλο υποστηρίζει και CATEGORY/VEHICLE· η σελίδα εκθέτει τα δύο
 *  που χρειάζονται σήμερα: γενικός κωδικός ή δεμένος σε πελάτη. */
export const DISCOUNT_TARGETS = ["ALL", "CUSTOMER"] as const;
export type DiscountTargetValue = (typeof DISCOUNT_TARGETS)[number];

export interface DiscountDTO {
  id: string;
  code: string | null;
  name: string;
  type: string;
  value: number;
  target: string;
  /** Για target = CUSTOMER είναι το id του πελάτη. */
  targetValue: string | null;
  /** Όνομα πελάτη για εμφάνιση· null όταν ο κωδικός είναι γενικός. */
  customerName: string | null;
  minDays: number | null;
  minAmount: number | null;
  maxDiscount: number | null;
  /** "YYYY-MM-DD" ή null — έτοιμο για <input type="date">. */
  validFrom: string | null;
  validUntil: string | null;
  usageLimit: number | null;
  usageCount: number;
  isActive: boolean;
  createdAt: string;
}

/** Γιατί ένας κωδικός δεν ισχύει αυτή τη στιγμή — για τη λίστα. */
export type DiscountState =
  | "ACTIVE"
  | "INACTIVE"
  | "SCHEDULED"
  | "EXPIRED"
  | "EXHAUSTED";

/**
 * Η κατάσταση που βλέπει ο διαχειριστής στη λίστα. Ίδια σειρά ελέγχων με
 * τον επιλυτή στο discounts.ts, ώστε να μη λέει η λίστα «Ενεργός» για
 * κωδικό που η κράτηση απορρίπτει.
 */
export function discountState(
  d: Pick<
    DiscountDTO,
    "isActive" | "validFrom" | "validUntil" | "usageLimit" | "usageCount"
  >,
  now: Date = new Date()
): DiscountState {
  if (!d.isActive) return "INACTIVE";

  const today = now.toISOString().slice(0, 10);
  if (d.validFrom && today < d.validFrom) return "SCHEDULED";
  if (d.validUntil && today > d.validUntil) return "EXPIRED";
  if (d.usageLimit !== null && d.usageCount >= d.usageLimit) return "EXHAUSTED";

  return "ACTIVE";
}

/** Κλάσεις pill που υπάρχουν ήδη στο dashboard.css. */
export const DISCOUNT_STATE_CLASS: Record<DiscountState, string> = {
  ACTIVE: "ok",
  INACTIVE: "muted",
  SCHEDULED: "info",
  EXPIRED: "bad",
  EXHAUSTED: "warn",
};
