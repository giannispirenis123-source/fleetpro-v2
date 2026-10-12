// src/lib/public/server.ts
// Φόρτωση δεδομένων για τη μηχανή τιμής — ΜΟΝΟ server.
//
// ΕΔΩ (και μόνο εδώ) τα ποσά σε € των παλιών πινάκων (vehicles.dailyRate,
// extras.price/excess/maxTotal) γίνονται cents, μέσω money.ts. Όλα τα
// ερωτήματα φιλτράρουν με companyId (της συνεδρίας ή του resolveStorefrontCompany).

import { db } from "../db";
import { normalizeStorefrontSettings } from "../storefront/settings";
import { toCents, toCentsOrNull } from "./money";
import { readLocalized } from "./text";
import type {
  AgeBandInput,
  ChargeInput,
  LocationInput,
  QuoteSettings,
  RateInput,
  SeasonInput,
  TargetInput,
  Tier,
  VehicleType,
} from "./pricing";

/** Κλίμακες από JSON: μόνο έγκυρες, ταξινομημένες. */
export function readTiers(value: unknown): Tier[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((t) => {
      if (!t || typeof t !== "object") return [];
      const o = t as Record<string, unknown>;
      const minDays = Number(o.minDays);
      const maxDays = o.maxDays === null || o.maxDays === undefined ? null : Number(o.maxDays);
      const price = Number(o.dailyPriceCents);
      if (!Number.isInteger(minDays) || minDays < 1) return [];
      if (maxDays !== null && (!Number.isInteger(maxDays) || maxDays < minDays)) return [];
      if (!Number.isInteger(price) || price < 0) return [];
      return [{ minDays, maxDays, dailyPriceCents: price }];
    })
    .sort((a, b) => a.minDays - b.minDays);
}

const asVehicleType = (v: string): VehicleType => (v === "moto" || v === "atv" ? v : "car");

export interface QuoteContext {
  settings: QuoteSettings;
  seasons: SeasonInput[];
  locations: (LocationInput & { isActive: boolean })[];
  ageBands: AgeBandInput[];
  extras: (ChargeInput & { kind: "EXTRA" | "INSURANCE"; isActive: boolean })[];
  /** Ομάδες και οχήματα χωρίς ομάδα, με τα rates τους. */
  groups: Map<string, { target: TargetInput; rates: RateInput[] }>;
  vehicles: Map<string, { target: TargetInput; rates: RateInput[] }>;
}

export async function loadQuoteContext(companyId: string): Promise<QuoteContext | null> {
  const [tenant, seasons, locations, ageBands, extras, groups, vehicles, rates] = await Promise.all([
    db.tenant.findUnique({ where: { id: companyId }, select: { vatRate: true, storefrontSettings: true } }),
    db.season.findMany({ where: { tenantId: companyId } }),
    db.pickupLocation.findMany({ where: { tenantId: companyId } }),
    db.driverAgeBand.findMany({ where: { tenantId: companyId } }),
    db.extra.findMany({ where: { tenantId: companyId } }),
    db.rentalGroup.findMany({ where: { tenantId: companyId } }),
    db.vehicle.findMany({
      where: { tenantId: companyId, isActive: true },
      select: { id: true, dailyRate: true, vehicleType: true },
    }),
    db.rate.findMany({ where: { tenantId: companyId } }),
  ]);
  if (!tenant) return null;
  const booking = normalizeStorefrontSettings(tenant.storefrontSettings).booking;

  const ratesFor = (key: "rentalGroupId" | "vehicleId", id: string): RateInput[] =>
    rates.filter((r) => r[key] === id).map((r) => ({ seasonId: r.seasonId, tiers: readTiers(r.tiers) }));

  return {
    settings: {
      timezone: booking.timezone,
      graceMinutes: booking.graceMinutes,
      afterHours: booking.afterHours,
      oneWayFeeCents: booking.oneWayFeeCents,
      minLeadHours: booking.minLeadHours,
      maxAdvanceDays: booking.maxAdvanceDays,
      vatPercent: Number(tenant.vatRate),
    },
    seasons: seasons.map((s) => ({
      id: s.id,
      name: readLocalized(s.name),
      startMonthDay: s.startMonthDay,
      endMonthDay: s.endMonthDay,
      minDays: s.minDays,
      priority: s.priority,
      sortOrder: s.sortOrder,
    })),
    locations: locations.map((l) => ({
      id: l.id,
      name: readLocalized(l.name),
      adjustmentType: l.adjustmentType === "percent" || l.adjustmentType === "fixed" ? l.adjustmentType : "none",
      adjustmentValue: l.adjustmentValue,
      adjustmentLabel: readLocalized(l.adjustmentLabel),
      afterHoursFeeCents: l.afterHoursFeeCents,
      allowPickup: l.allowPickup,
      allowDropoff: l.allowDropoff,
      isActive: l.isActive,
    })),
    ageBands: ageBands.map((b) => ({
      minAge: b.minAge,
      maxAge: b.maxAge,
      label: readLocalized(b.label),
      allowed: b.allowed,
      isDefault: b.isDefault,
      surchargeType: b.surchargeType === "per_day" || b.surchargeType === "per_rental" ? b.surchargeType : "none",
      surchargeCents: b.surchargeCents,
      surchargeMaxCents: b.surchargeMaxCents,
    })),
    // Τα extras ζουν σε € (Decimal): η ΜΟΝΗ μετατροπή σε cents.
    extras: extras.map((e) => {
      const name = readLocalized(e.nameI18n);
      return {
        id: e.id,
        kind: e.type,
        isActive: e.isActive,
        name: name.el ? name : { ...name, el: e.name },
        priceType: e.chargeType === "PER_DAY" ? "per_day" : "per_rental",
        priceCents: toCents(e.price),
        maxTotalCents: toCentsOrNull(e.maxTotal),
        maxQuantity: e.maxQuantity,
        vehicleTypes: e.vehicleTypes,
        excessCents: toCentsOrNull(e.excess),
      };
    }),
    groups: new Map(
      groups.map((g) => [
        g.id,
        {
          target: {
            vehicleType: asVehicleType(g.vehicleType),
            basePriceCents: g.basePriceCents,
            depositCents: g.depositCents,
            excessCents: g.excessCents,
            minDriverAge: g.minDriverAge,
          },
          rates: ratesFor("rentalGroupId", g.id),
        },
      ])
    ),
    vehicles: new Map(
      vehicles.map((v) => [
        v.id,
        {
          target: {
            vehicleType: asVehicleType(v.vehicleType),
            basePriceCents: toCents(v.dailyRate),
            depositCents: null,
            excessCents: null,
            minDriverAge: null,
          },
          rates: ratesFor("vehicleId", v.id),
        },
      ])
    ),
  };
}
