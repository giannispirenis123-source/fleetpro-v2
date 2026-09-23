// src/lib/discountMapper.ts
// Μετατροπή Discount → DTO. Χωριστά από το discounts.ts ώστε να μπορεί να
// το εισάγει και ο server χωρίς να τραβά τη λογική επίλυσης.

import type { Discount } from "@prisma/client";
import type { DiscountDTO } from "./discountsShared";

const toDateInput = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

export function toDiscountDTO(
  d: Discount,
  customerName: string | null = null
): DiscountDTO {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    type: d.type,
    value: Number(d.value),
    target: d.target,
    targetValue: d.targetValue,
    customerName,
    minDays: d.minDays,
    minAmount: d.minAmount === null ? null : Number(d.minAmount),
    maxDiscount: d.maxDiscount === null ? null : Number(d.maxDiscount),
    validFrom: toDateInput(d.validFrom),
    validUntil: toDateInput(d.validUntil),
    usageLimit: d.usageLimit,
    usageCount: d.usageCount,
    isActive: d.isActive,
    createdAt: d.createdAt.toISOString(),
  };
}
