// src/lib/public/extras.ts
// Extras & ασφάλειες του site πάνω στον ΥΠΑΡΧΟΝΤΑ πίνακα extras.
// Στη βάση τα ποσά μένουν σε € (Decimal)· εδώ γίνονται cents (money.ts).

import { z } from "zod";
import type { Extra } from "@prisma/client";
import { toCents, toCentsOrNull } from "./money";
import { readLocalized } from "./text";
import { i18nField } from "./resources";
import { VEHICLE_TYPES } from "./pricing";

export function toPublicExtraDTO(e: Extra) {
  const name = readLocalized(e.nameI18n);
  return {
    id: e.id,
    type: e.type,
    chargeType: e.chargeType,
    priceCents: toCents(e.price),
    excessCents: toCentsOrNull(e.excess),
    nameI18n: name.el ? name : { ...name, el: e.name },
    descriptionI18n: readLocalized(e.descriptionI18n),
    maxTotalCents: toCentsOrNull(e.maxTotal),
    maxQuantity: e.maxQuantity,
    vehicleTypes: e.vehicleTypes,
    sortOrder: e.sortOrder,
    isActive: e.isActive,
  };
}

export type PublicExtraDTO = ReturnType<typeof toPublicExtraDTO>;

export const publicExtraSchema = z.object({
  nameI18n: i18nField(80, true, "Το όνομα (ΕΛ)"),
  descriptionI18n: i18nField(300),
  maxTotalCents: z.number().int().min(0, "Το ταβάνι δεν μπορεί να είναι αρνητικό").max(10_000_000).nullable(),
  maxQuantity: z.number().int().min(1, "Τουλάχιστον 1").max(10, "Έως 10"),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).max(3).transform((l) => Array.from(new Set(l))),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
});
