// src/lib/public/server.ts
// Φόρτωση δεδομένων για τη μηχανή τιμής — ΜΟΝΟ server.
//
// ΕΔΩ (και μόνο εδώ) τα ποσά σε € των παλιών πινάκων (vehicles.dailyRate,
// extras.price/excess/maxTotal) γίνονται cents, μέσω money.ts. Όλα τα
// ερωτήματα φιλτράρουν με companyId (της συνεδρίας ή του resolveStorefrontCompany).

import { db } from "../db";
import { normalizeStorefrontSettings } from "../storefront/settings";
import { toCents, toCentsOrNull } from "./money";
import { readLocalized, readLocalizedList, type LocalizedText } from "./text";
import { migrateLegacyFixed } from "./pricing";
import { isoDate } from "./resources";
import type {
  AgeBandInput,
  ChargeInput,
  LocationInput,
  PromotionInput,
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
  /** Με τη σειρά τους (sortOrder)· slug για τα URL του site. */
  /** needsFlight: το σημείο ζητά πτήση (askFlightNumber ή τύπος «αεροδρόμιο»). */
  locations: (LocationInput & { isActive: boolean; slug: string; needsFlight: boolean })[];
  /** Με σειρά ηλικίας· explanation για την επιλογή στο site. */
  ageBands: (AgeBandInput & { explanation: LocalizedText })[];
  promotions: PromotionInput[];
  /** Πρόσθετα ΚΑΙ επίπεδα ασφάλειας (kind INSURANCE) — καμία «προεπιλογή». */
  extras: (ChargeInput & { kind: "EXTRA" | "INSURANCE"; isActive: boolean; description: LocalizedText; sortOrder: number })[];
  /** Ομάδες και οχήματα χωρίς ομάδα, με τα rates τους. */
  groups: Map<string, { target: TargetInput; rates: RateInput[] }>;
  vehicles: Map<string, { target: TargetInput; rates: RateInput[] }>;
}

export async function loadQuoteContext(companyId: string): Promise<QuoteContext | null> {
  const [tenant, seasons, locations, ageBands, extras, groups, vehicles, rates, promotions] = await Promise.all([
    db.tenant.findUnique({ where: { id: companyId }, select: { vatRate: true, storefrontSettings: true } }),
    db.season.findMany({ where: { tenantId: companyId } }),
    db.pickupLocation.findMany({ where: { tenantId: companyId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.driverAgeBand.findMany({ where: { tenantId: companyId }, orderBy: [{ minAge: "asc" }] }),
    db.extra.findMany({ where: { tenantId: companyId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.rentalGroup.findMany({ where: { tenantId: companyId } }),
    db.vehicle.findMany({
      where: { tenantId: companyId, isActive: true },
      select: { id: true, dailyRate: true, vehicleType: true, rentalGroupId: true },
    }),
    db.rate.findMany({ where: { tenantId: companyId } }),
    db.promotion.findMany({ where: { tenantId: companyId }, orderBy: [{ sortOrder: "asc" }] }),
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
    // migrateLegacyFixed: ίδιος κανόνας με το SQL 21c, για όποια γραμμή δεν έχει περάσει ακόμα.
    locations: locations.map((l) => migrateLegacyFixed({
      id: l.id,
      slug: l.slug,
      needsFlight: l.askFlightNumber || l.type === "airport",
      name: readLocalized(l.name),
      adjustmentType: l.adjustmentType === "percent" || l.adjustmentType === "fixed" ? l.adjustmentType : "none",
      adjustmentValue: l.adjustmentValue,
      adjustmentLabel: readLocalized(l.adjustmentLabel),
      afterHoursFeeCents: l.afterHoursFeeCents,
      allowPickup: l.allowPickup,
      allowDropoff: l.allowDropoff,
      isActive: l.isActive,
      deliveryFeeCents: l.deliveryFeeCents,
      collectionFeeCents: l.collectionFeeCents,
      feeFreeFromDays: l.feeFreeFromDays,
      feeLabel: readLocalized(l.feeLabel),
    }) as LocationInput & { isActive: boolean; slug: string; needsFlight: boolean }),
    promotions: promotions.map((p) => ({
      id: p.id,
      name: readLocalized(p.name),
      badge: readLocalized(p.badge),
      isActive: p.isActive,
      discountType: p.discountType === "per_day" || p.discountType === "per_rental" ? p.discountType : "percent",
      discountValue: p.discountValue,
      validFrom: isoDate(p.validFrom),
      validTo: isoDate(p.validTo),
      locationIds: p.locationIds,
      locationMatch: p.locationMatch === "dropoff" || p.locationMatch === "either" ? p.locationMatch : "pickup",
      rentalGroupIds: p.rentalGroupIds,
      vehicleIds: p.vehicleIds,
      vehicleTypes: p.vehicleTypes,
      minDays: p.minDays,
      sortOrder: p.sortOrder,
    })),
    ageBands: ageBands.map((b) => ({
      minAge: b.minAge,
      maxAge: b.maxAge,
      label: readLocalized(b.label),
      explanation: readLocalized(b.explanation),
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
        description: readLocalized(e.descriptionI18n),
        sortOrder: e.sortOrder,
        coverages: e.type === "INSURANCE" ? readLocalizedList(e.coveragesI18n) : [],
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
            rentalGroupId: g.id,
            vehicleId: null,
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
            rentalGroupId: v.rentalGroupId,
            vehicleId: v.id,
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
