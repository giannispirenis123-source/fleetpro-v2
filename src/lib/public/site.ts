// src/lib/public/site.ts
// Τα δεδομένα των σελίδων του δημόσιου site (αρχική, αναζήτηση, περίληψη
// κράτησης) — ΜΟΝΟ server.
//
// · Η εταιρία (companyId) έρχεται ΜΟΝΟ από το resolveStorefrontCompany.
//   Κάθε ερώτημα εδώ φιλτράρει με αυτό.
// · Τιμή ΜΟΝΟ από quote()/fromPrice() (pricing.ts)· ποσά μόνο σε cents.
// · Διαθεσιμότητα ΜΟΝΟ από availability.ts (ΕΝΑ ερώτημα κρατήσεων ανά αναζήτηση).
// · Στη σελίδα φεύγουν μόνο κάρτες (catalog.ts) και αριθμοί — ποτέ ids
//   ομάδων/τοποθεσιών, πινακίδες ή κρατήσεις.

import { cache } from "react";
import { db } from "../db";
import { readVehiclePhotos } from "../vehiclePhotos";
import { loadBlockingBookings, countAvailableByGroup } from "./availability";
import {
  buildCards,
  vehicleCardKey,
  type CatalogGroup,
  type CatalogVehicle,
  type PublicCard,
  type ResultCard,
} from "./catalog";
import { fromPrice, type QuoteResult } from "./pricing";
import { hasUnpricedDay, quoteFromContext, requestFromCriteria, subjectOf } from "./engine";
import { nowLocal, type SearchCriteria, type SearchRules } from "./search";
import { loadQuoteContext, type QuoteContext } from "./server";
import { readLocalized, textFor, type LocalizedText } from "./text";
import { normalizeStorefrontSettings } from "../storefront/settings";

export type RentalModeValue = "BOOKING" | "REQUEST";

export interface SiteLocation {
  slug: string;
  name: LocalizedText;
  allowPickup: boolean;
  allowDropoff: boolean;
}

export interface SiteAgeBand {
  minAge: number;
  maxAge: number;
  label: LocalizedText;
  explanation: LocalizedText;
  allowed: boolean;
  isDefault: boolean;
  surchargeType: string;
}

export interface SiteCatalog {
  companyId: string;
  ctx: QuoteContext;
  prepTimeMinutes: number;
  groups: CatalogGroup[];
  vehicles: CatalogVehicle[];
  /** Ενεργές τοποθεσίες, με τη σειρά τους. */
  locations: SiteLocation[];
  /** Μόνο επιτρεπτές κλίμακες ηλικίας, με σειρά ηλικίας. */
  ageBands: SiteAgeBand[];
  rules: SearchRules;
}

async function loadCatalog(companyId: string): Promise<SiteCatalog | null> {
  const [ctx, tenant, groups, vehicles] = await Promise.all([
    loadQuoteContext(companyId),
    db.tenant.findUnique({ where: { id: companyId }, select: { prepTimeMinutes: true, storefrontSettings: true } }),
    db.rentalGroup.findMany({
      where: { tenantId: companyId, isActive: true, isPublic: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: {
        id: true, code: true, vehicleType: true, name: true, similarModels: true, seats: true, doors: true,
        transmission: true, fuel: true, bagsLarge: true, bagsSmall: true, airCondition: true, engineCc: true,
        photos: true, sortOrder: true,
      },
    }),
    // Τα οχήματα του site — ΜΟΝΟ τα πεδία που χρειάζονται (καμία πινακίδα/χλμ/σημείωση).
    db.vehicle.findMany({
      where: { tenantId: companyId, isActive: true, publicVisible: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      select: {
        id: true, tenantId: true, rentalGroupId: true, brand: true, model: true, vehicleType: true, seats: true,
        doors: true, transmission: true, fuel: true, ac: true, photos: true, status: true, isActive: true,
      },
    }),
  ]);
  if (!ctx || !tenant) return null;
  const booking = normalizeStorefrontSettings(tenant.storefrontSettings).booking;

  const locations = ctx.locations
    .filter((l) => l.isActive)
    .map((l) => ({ slug: l.slug, name: l.name, allowPickup: l.allowPickup, allowDropoff: l.allowDropoff }));
  const ageBands = ctx.ageBands
    .filter((b) => b.allowed)
    .map((b) => ({
      minAge: b.minAge,
      maxAge: b.maxAge,
      label: b.label,
      explanation: b.explanation,
      allowed: b.allowed,
      isDefault: b.isDefault,
      surchargeType: b.surchargeType,
    }));

  return {
    companyId,
    ctx,
    prepTimeMinutes: tenant.prepTimeMinutes,
    groups: groups.map((g) => ({
      id: g.id,
      code: g.code,
      vehicleType: g.vehicleType,
      name: readLocalized(g.name),
      similarModels: readLocalized(g.similarModels),
      seats: g.seats,
      doors: g.doors,
      transmission: g.transmission,
      fuel: g.fuel,
      bagsLarge: g.bagsLarge,
      bagsSmall: g.bagsSmall,
      airCondition: g.airCondition,
      engineCc: g.engineCc,
      photoUrl: readVehiclePhotos(g.photos)[0]?.url ?? null,
      sortOrder: g.sortOrder,
    })),
    vehicles: vehicles.map((v) => ({
      id: v.id,
      tenantId: v.tenantId,
      rentalGroupId: v.rentalGroupId,
      brand: v.brand,
      model: v.model,
      vehicleType: v.vehicleType,
      seats: v.seats,
      doors: v.doors,
      transmission: v.transmission,
      fuel: v.fuel,
      ac: v.ac,
      photoUrl: readVehiclePhotos(v.photos)[0]?.url ?? null,
      status: v.status,
      isActive: v.isActive,
    })),
    locations,
    ageBands,
    rules: {
      timezone: ctx.settings.timezone,
      graceMinutes: ctx.settings.graceMinutes,
      minLeadHours: booking.minLeadHours,
      maxAdvanceDays: booking.maxAdvanceDays,
      defaultPickupTime: booking.defaultPickupTime,
      defaultDropoffTime: booking.defaultDropoffTime,
      defaultRentalDays: booking.defaultRentalDays,
      // Πάνε και στον browser: χωρίς τα εσωτερικά ids των σεζόν.
      seasons: ctx.seasons.map((x, i) => ({
        id: `s${i}`,
        name: x.name,
        startMonthDay: x.startMonthDay,
        endMonthDay: x.endMonthDay,
        minDays: x.minDays,
        priority: x.priority,
        sortOrder: x.sortOrder,
      })),
      // Όλες οι κλίμακες (και οι μη επιτρεπτές), για σωστό μήνυμα ηλικίας.
      ageBands: ctx.ageBands.map((b) => ({
        minAge: b.minAge,
        maxAge: b.maxAge,
        allowed: b.allowed,
        isDefault: b.isDefault,
        surchargeType: b.surchargeType,
      })),
      locations,
    },
  };
}

/** Μία φόρτωση ανά αίτημα (metadata + σελίδα). */
export const loadSiteCatalog = cache(loadCatalog);

/* ─────────────────────────────────────────────
   Τιμή μιας κάρτας — ΜΟΝΟ μέσω quote()
   ───────────────────────────────────────────── */

/** Ομάδα/όχημα μιας κάρτας — ίδια αντιστοίχιση με την quote (engine.subjectOf). */
function subjectFor(cat: SiteCatalog, key: string) {
  if (key.startsWith("v.") && !cat.vehicles.some((v) => v.id === key.slice(2) && !v.rentalGroupId)) return null;
  const req = requestFromCriteria(cat.ctx, cat.groups, key, { pl: null, dl: null, from: "", to: "", age: null });
  return req ? subjectOf(cat.ctx, req.target) : null;
}

/**
 * Η τιμή μιας κάρτας — ΙΔΙΑ μηχανή με το dashboard (engine.ts):
 * κριτήρια URL → request → quoteFromContext → quote().
 */
export function quoteCard(cat: SiteCatalog, key: string, c: SearchCriteria, now = new Date()): QuoteResult | null {
  // Όχημα με ομάδα δεν έχει δική του κάρτα στο site.
  if (key.startsWith("v.") && !cat.vehicles.some((v) => v.id === key.slice(2) && !v.rentalGroupId)) return null;
  const req = requestFromCriteria(cat.ctx, cat.groups, key, c, now);
  if (!req) return null;
  const out = quoteFromContext(cat.ctx, req);
  return out.ok ? out.result : null;
}

export { hasUnpricedDay };

/* ─────────────────────────────────────────────
   Κάρτες: αρχική (fromPrice) και αναζήτηση (quote + διαθεσιμότητα)
   ───────────────────────────────────────────── */

export function homeCards(cat: SiteCatalog, lang: string, now = new Date()): ResultCard[] {
  const today = nowLocal(cat.rules.timezone, now).slice(0, 10);
  return buildCards(cat.groups, cat.vehicles, lang).map((card) => {
    const subject = subjectFor(cat, card.key);
    const fp = subject
      ? fromPrice(subject.target, subject.rates, cat.ctx.seasons, today, {
          horizonDays: Math.min(365, cat.rules.maxAdvanceDays),
          promotions: cat.ctx.promotions,
        })
      : null;
    return {
      ...card,
      price: null,
      from: fp ? { dailyCents: fp.dailyCents, listDailyCents: fp.listDailyCents, badge: fp.badge ? textFor(fp.badge, lang) : null } : null,
      available: null,
      note: null,
      bookHref: null,
    };
  });
}

export async function searchCards(
  cat: SiteCatalog,
  c: SearchCriteria,
  lang: string,
  bookHref: (card: PublicCard) => string,
  unavailableText: string,
  now = new Date()
): Promise<ResultCard[]> {
  const cards = buildCards(cat.groups, cat.vehicles, lang);
  const bookings = await loadBlockingBookings(db, cat.companyId, { from: c.from, to: c.to });
  const counts = countAvailableByGroup({
    companyId: cat.companyId,
    vehicles: cat.vehicles.map((v) => ({
      id: v.id,
      tenantId: v.tenantId,
      groupKey: vehicleCardKey(v, cat.groups),
      status: v.status,
      isActive: v.isActive,
    })),
    bookings,
    from: c.from,
    to: c.to,
    prepMinutes: cat.prepTimeMinutes,
    now: nowLocal(cat.rules.timezone, now),
  });

  return cards.map((card) => {
    const q = quoteCard(cat, card.key, c, now);
    const available = counts.get(card.key) ?? 0;
    let price: ResultCard["price"] = null;
    let note: string | null = null;
    if (!q || hasUnpricedDay(q)) {
      // Χωρίς τιμή για όλες τις ημέρες → ΔΕΝ εμφανίζεται ως διαθέσιμο.
      // Log χωρίς προσωπικά δεδομένα: μόνο κάρτα και ημερομηνίες.
      console.warn("[FleetPro] site: χωρίς τιμή για κάποια ημέρα", {
        card: card.key,
        from: c.from.slice(0, 10),
        to: c.to.slice(0, 10),
      });
      note = unavailableText;
    } else {
      price = {
        days: q.days,
        totalCents: q.totalCents,
        listTotalCents: q.listTotalCents,
        avgDailyCents: q.avgDailyCents,
        badge: q.discountBadge ? textFor(q.discountBadge, lang) : null,
      };
      if (!q.ok) note = q.errors[0] ? (lang === "el" ? q.errors[0].message.el : q.errors[0].message.en) : unavailableText;
    }
    const bookable = available > 0 && price !== null && note === null;
    return { ...card, price, from: null, available, note, bookHref: bookable ? bookHref(card) : null };
  });
}
