// src/lib/platformDiscounts.ts
// Εκπτώσεις Super Admin στη ΣΥΝΔΡΟΜΗ μιας εταιρίας — DTO και υπολογισμοί.
//
// Άσχετο με τις εκπτώσεις κρατήσεων (discounts.ts). Μόνο αποθήκευση και
// εμφάνιση· δεν συνδέεται ακόμα με Stripe/billing.
//
// Client-safe: ΔΕΝ εισάγει db (μόνο τύπους), ώστε το UI του Super Admin να
// υπολογίζει την τελική τιμή με τον ίδιο κώδικα που χρησιμοποιεί ο server.

import type {
  PlatformDiscount,
  PlatformDiscountType,
  SubscriptionPlan,
} from "@prisma/client";

export const PLATFORM_DISCOUNT_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"] as const;

/** Μηνιαία τιμή συνδρομής ανά πλάνο (€). Το Tenant αποθηκεύει μόνο το πλάνο. */
export const PLAN_PRICES: Record<SubscriptionPlan, number> = {
  STARTER: 49,
  PRO: 129,
  ENTERPRISE: 299,
};

export interface PlatformDiscountDTO {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantPlan: SubscriptionPlan;
  type: PlatformDiscountType;
  value: number;
  /** "YYYY-MM-DD" */
  validFrom: string;
  /** "YYYY-MM-DD" ή null = μέχρι να διακοπεί */
  validUntil: string | null;
  active: boolean;
  note: string | null;
  createdAt: string;
}

/** Στήλη @db.Date → "YYYY-MM-DD" (η Prisma τη φέρνει ως μεσάνυχτα UTC). */
export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → Date για στήλη @db.Date. */
export function parseDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Η σημερινή ημερομηνία στην Ελλάδα, ως "YYYY-MM-DD". */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(now);
}

export function toPlatformDiscountDTO(
  d: PlatformDiscount & { tenant: { name: string; plan: SubscriptionPlan } }
): PlatformDiscountDTO {
  return {
    id: d.id,
    tenantId: d.tenantId,
    tenantName: d.tenant.name,
    tenantPlan: d.tenant.plan,
    type: d.type,
    value: Number(d.value),
    validFrom: dateOnly(d.validFrom),
    validUntil: d.validUntil ? dateOnly(d.validUntil) : null,
    active: d.active,
    note: d.note,
    createdAt: d.createdAt.toISOString(),
  };
}

export type PlatformDiscountStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "INACTIVE";

/** Κατάσταση όπως τη βλέπει ο Super Admin σήμερα. Σύγκριση ως κείμενο "YYYY-MM-DD". */
export function platformDiscountStatus(
  d: Pick<PlatformDiscountDTO, "active" | "validFrom" | "validUntil">,
  today: string = todayISO()
): PlatformDiscountStatus {
  if (!d.active) return "INACTIVE";
  if (d.validFrom > today) return "SCHEDULED";
  if (d.validUntil && d.validUntil < today) return "EXPIRED";
  return "ACTIVE";
}

/** Τελική μηνιαία τιμή μετά την έκπτωση — ποτέ κάτω από 0, στρογγυλή στα λεπτά. */
export function discountedPrice(
  basePrice: number,
  d: Pick<PlatformDiscountDTO, "type" | "value">
): number {
  const off = d.type === "PERCENTAGE" ? (basePrice * d.value) / 100 : d.value;
  return Math.max(0, Math.round((basePrice - off) * 100) / 100);
}
