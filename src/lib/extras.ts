// src/lib/extras.ts
// Πρόσθετα και ασφάλειες ανά εταιρία — κοινό σημείο για API και σελίδα.

import type { Extra } from "@prisma/client";

export const CHARGE_TYPES = ["PER_DAY", "ONE_OFF"] as const;
export const EXTRA_TYPES = ["EXTRA", "INSURANCE"] as const;

export type ChargeTypeValue = (typeof CHARGE_TYPES)[number];
export type ExtraTypeValue = (typeof EXTRA_TYPES)[number];

/** Χρώμα του pill ανά είδος — κλάσεις που υπάρχουν ήδη στο dashboard.css. */
export const EXTRA_TYPE_CLASS: Record<string, string> = {
  EXTRA: "info",
  INSURANCE: "ok",
};

export interface ExtraDTO {
  id: string;
  name: string;
  price: number;
  chargeType: string;
  type: string;
  isActive: boolean;
}

export function toExtraDTO(e: Extra): ExtraDTO {
  return {
    id: e.id,
    name: e.name,
    price: Number(e.price),
    chargeType: e.chargeType,
    type: e.type,
    isActive: e.isActive,
  };
}
