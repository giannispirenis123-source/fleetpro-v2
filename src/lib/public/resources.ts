// src/lib/public/resources.ts
// Οι «λίστες» του δημόσιου site (ομάδες, τοποθεσίες, σεζόν, ηλικίες οδηγού)
// — ΕΝΑΣ καταχωρητής για το κοινό CRUD (/api/public-site/[resource]). ΜΟΝΟ server.
//
// · Κάθε ερώτημα φιλτράρει με το companyId της ΣΥΝΕΔΡΙΑΣ (withPublicSite).
// · Zod σε κάθε εγγραφή· οι φόρμες στέλνουν ΟΛΗ την εγγραφή (POST/PATCH).
// · Ποσά σε cents. Κείμενα JSONB ανά γλώσσα.
// · Ομάδα σε χρήση (έχει οχήματα) → «Ανενεργή» αντί για διαγραφή.

import { z } from "zod";
import { db } from "../db";
import { FUEL_TYPES } from "../vehicles";
import { readVehiclePhotos, toPhotoViews } from "../vehiclePhotos";
import { readLocalized } from "./text";
import { VEHICLE_TYPES } from "./pricing";
import { destroyPhotos } from "./photos";
import { placeSchema, placeToData, readPlaceDetails } from "./places";
import { GOOGLE_PLACE_ID_RE, reviewSchema } from "./reviews";

/* ─────────────────────────────────────────────
   Κοινά πεδία
   ───────────────────────────────────────────── */

/** Κείμενο ανά γλώσσα. required: το ελληνικό είναι υποχρεωτικό. */
export const i18nField = (max: number, required = false, label = "Το ελληνικό κείμενο") =>
  z
    .record(z.string().regex(/^[a-z]{2}$/), z.string().max(max, `Έως ${max} χαρακτήρες`))
    .default({})
    .transform((t) => readLocalized(t, max))
    .refine((t) => !required || !!t.el, `${label} είναι υποχρεωτικό`);

const cents = z.number().int("Μη έγκυρο ποσό").min(0, "Το ποσό δεν μπορεί να είναι αρνητικό").max(10_000_000);
const optInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable().default(null);
const sortOrder = z.number().int().min(0).max(10_000).default(0);

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthDay = z
  .string()
  .regex(MONTH_DAY, "Ημερομηνία σε μορφή ΜΜ-ΗΗ (π.χ. 06-15)")
  .refine((v) => Number(v.slice(3)) <= DAYS_IN_MONTH[Number(v.slice(0, 2)) - 1], "Ο μήνας δεν έχει τόσες ημέρες");

/* ─────────────────────────────────────────────
   Σχήματα
   ───────────────────────────────────────────── */

export const groupSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/, "Κωδικός: λατινικά κεφαλαία, αριθμοί και παύλα (έως 20)"),
  vehicleType: z.enum(VEHICLE_TYPES),
  name: i18nField(80, true, "Το όνομα (ΕΛ)"),
  description: i18nField(1000),
  similarModels: i18nField(120),
  seats: z.number().int().min(1, "Τουλάχιστον 1 θέση").max(60),
  doors: optInt(0, 10),
  transmission: z.enum(["manual", "automatic"]),
  fuel: z.enum(FUEL_TYPES),
  bagsLarge: z.number().int().min(0).max(20).default(0),
  bagsSmall: z.number().int().min(0).max(20).default(0),
  airCondition: z.boolean().default(true),
  engineCc: optInt(0, 5000),
  minDriverAge: optInt(16, 99),
  licenceCategory: z.string().trim().max(10).nullable().default(null).transform((v) => v || null),
  basePriceCents: cents,
  depositCents: cents.nullable().default(null),
  excessCents: cents.nullable().default(null),
  sortOrder,
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const LOCATION_TYPES = ["airport", "port", "office", "city", "hotel", "other"] as const;

export const locationSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug: λατινικά πεζά, αριθμοί και παύλα")
      .min(2, "Τουλάχιστον 2 χαρακτήρες")
      .max(60),
    name: i18nField(80, true, "Το όνομα (ΕΛ)"),
    type: z.enum(LOCATION_TYPES),
    address: z.string().trim().max(200).nullable().default(null).transform((v) => v || null),
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
    askFlightNumber: z.boolean().default(false),
    askFerryName: z.boolean().default(false),
    askAddress: z.boolean().default(false),
    // Μόνο ποσοστό: η σταθερή χρέωση έγινε χρεώσεις δρομολογίου (SQL 21c).
    adjustmentType: z.enum(["none", "percent"]),
    adjustmentValue: z.number().int().min(-100).max(100).default(0),
    adjustmentLabel: i18nField(80),
    afterHoursFeeCents: cents.nullable().default(null),
    deliveryFeeCents: cents.default(0),
    collectionFeeCents: cents.default(0),
    feeFreeFromDays: optInt(1, 365),
    feeLabel: i18nField(80),
    allowPickup: z.boolean().default(true),
    allowDropoff: z.boolean().default(true),
    sortOrder,
    isActive: z.boolean().default(true),
    /** Για τις κριτικές Google (SQL 26)· κενό = καμία. */
    googlePlaceId: z
      .string()
      .trim()
      .nullable()
      .default(null)
      .transform((v) => v || null)
      .refine((v) => v === null || GOOGLE_PLACE_ID_RE.test(v), "Μη έγκυρο Google Place ID (π.χ. ChIJ…)"),
  })
  .refine((l) => l.adjustmentType !== "percent" || (l.adjustmentValue >= -100 && l.adjustmentValue <= 100), {
    message: "Το ποσοστό πρέπει να είναι από −100 έως 100",
    path: ["adjustmentValue"],
  })
  .refine((l) => l.allowPickup || l.allowDropoff, {
    message: "Το σημείο πρέπει να επιτρέπει παραλαβή ή επιστροφή",
    path: ["allowPickup"],
  });

export const seasonSchema = z.object({
  name: i18nField(60, true, "Το όνομα (ΕΛ)"),
  startMonthDay: monthDay,
  endMonthDay: monthDay,
  minDays: optInt(1, 60),
  priority: z.number().int().min(0).max(100).default(0),
  sortOrder,
});

export const ageBandSchema = z
  .object({
    minAge: z.number().int().min(16, "Ελάχιστη ηλικία 16").max(120),
    maxAge: z.number().int().min(16).max(120),
    label: i18nField(60, true, "Η ετικέτα (ΕΛ)"),
    explanation: i18nField(300),
    allowed: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    surchargeType: z.enum(["none", "per_day", "per_rental"]),
    surchargeCents: cents.default(0),
    surchargeMaxCents: cents.nullable().default(null),
    sortOrder,
  })
  .refine((b) => b.minAge <= b.maxAge, { message: "Η ελάχιστη ηλικία δεν μπορεί να ξεπερνά τη μέγιστη", path: ["maxAge"] })
  .refine((b) => !b.isDefault || b.allowed, { message: "Η προεπιλογή πρέπει να είναι επιτρεπτή ηλικία", path: ["isDefault"] });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = z
  .string()
  .regex(ISO_DATE, "Ημερομηνία σε μορφή ΕΕΕΕ-ΜΜ-ΗΗ")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Μη έγκυρη ημερομηνία");
const idList = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(200).default([]).transform((l) => Array.from(new Set(l)));

export const promotionSchema = z
  .object({
    name: i18nField(80, true, "Το όνομα (ΕΛ)"),
    badge: i18nField(60, true, "Το κείμενο στο site (ΕΛ)"),
    isActive: z.boolean().default(true),
    discountType: z.enum(["percent", "per_day", "per_rental"]),
    discountValue: z.number().int().min(1, "Η έκπτωση πρέπει να είναι πάνω από 0").max(10_000_000),
    validFrom: dateField,
    validTo: dateField,
    locationIds: idList,
    locationMatch: z.enum(["pickup", "dropoff", "either"]).default("pickup"),
    rentalGroupIds: idList,
    vehicleIds: idList,
    vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).max(3).default([]).transform((l) => Array.from(new Set(l))),
    minDays: optInt(1, 365),
    sortOrder,
  })
  .refine((p) => p.discountType !== "percent" || p.discountValue <= 90, {
    message: "Το ποσοστό έκπτωσης πρέπει να είναι έως 90%",
    path: ["discountValue"],
  })
  .refine((p) => p.validFrom <= p.validTo, { message: "Το «Από» πρέπει να είναι πριν ή ίσο με το «Έως»", path: ["validTo"] })
  .transform((p) => ({
    ...p,
    validFrom: new Date(`${p.validFrom}T00:00:00.000Z`),
    validTo: new Date(`${p.validTo}T00:00:00.000Z`),
  }));

/** Ημερομηνία DATE από Prisma (UTC μεσάνυχτα) → "YYYY-MM-DD". */
export const isoDate = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ""));

/* ─────────────────────────────────────────────
   Καταχωρητής
   ───────────────────────────────────────────── */

// Γενικός τύπος για τα Prisma delegates (rentalGroup, pickupLocation, …):
// οι κλήσεις είναι πάντα με where { tenantId } από τον καλούντα.
interface Delegate {
  findMany(args: any): Promise<any[]>;
  findFirst(args: any): Promise<any>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  delete(args: any): Promise<any>;
}

export interface ResourceDef {
  delegate: () => Delegate;
  schema: z.ZodTypeAny;
  orderBy: Record<string, "asc" | "desc">[];
  include?: Record<string, unknown>;
  toDTO: (row: any) => Record<string, unknown>;
  /** Μήνυμα όταν παραβιάζεται το unique (code/slug). */
  uniqueMessage?: string;
  /** Επιπλέον έλεγχος με τα υπόλοιπα της εταιρίας (π.χ. επικάλυψη ηλικιών). */
  check?: (companyId: string, data: any, id: string | null) => Promise<string | null>;
  /** Μετά την αποθήκευση (π.χ. μία μόνο προεπιλογή). */
  afterSave?: (companyId: string, row: any) => Promise<void>;
  /** Σε χρήση → απενεργοποίηση αντί για διαγραφή. */
  inUse?: (companyId: string, id: string) => Promise<boolean>;
  deactivate?: Record<string, unknown>;
  /** Πριν τη διαγραφή (π.χ. φωτογραφίες από το Cloudinary)· μήνυμα = ακύρωση. */
  beforeDelete?: (companyId: string, id: string) => Promise<string | null>;
  /** Τα δεδομένα της φόρμας → δεδομένα Prisma (π.χ. σχέσεις). Προεπιλογή: ως έχουν. */
  toData?: (data: any, mode: "create" | "update") => Record<string, unknown>;
  /** «Πάνω/Κάτω» στη λίστα (στήλη sortOrder). */
  movable?: boolean;
}

const strip = (row: Record<string, unknown>) => {
  const { tenantId: _t, createdAt: _c, updatedAt: _u, ...rest } = row;
  return rest;
};

const jsonText = (row: Record<string, unknown>, keys: string[]) => {
  const out = { ...row };
  for (const k of keys) out[k] = readLocalized(row[k]);
  return out;
};

export const RESOURCES: Record<string, ResourceDef> = {
  groups: {
    delegate: () => db.rentalGroup as unknown as Delegate,
    schema: groupSchema,
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    include: { _count: { select: { vehicles: { where: { isActive: true } } } } },
    toDTO: (row) => {
      const { _count, photos, ...rest } = jsonText(strip(row), ["name", "description", "similarModels"]);
      return {
        ...rest,
        photos: toPhotoViews(readVehiclePhotos(photos)),
        vehicleCount: (_count as { vehicles?: number } | undefined)?.vehicles ?? 0,
      };
    },
    uniqueMessage: "Υπάρχει ήδη ομάδα με αυτόν τον κωδικό",
    inUse: async (companyId, id) =>
      (await db.vehicle.count({ where: { tenantId: companyId, rentalGroupId: id } })) > 0,
    deactivate: { isActive: false, isPublic: false },
    beforeDelete: async (companyId, id) => {
      const g = await db.rentalGroup.findFirst({ where: { id, tenantId: companyId }, select: { photos: true } });
      const ok = await destroyPhotos(readVehiclePhotos(g?.photos));
      return ok ? null : "Οι φωτογραφίες της ομάδας δεν σβήστηκαν από το Cloudinary. Δοκιμάστε ξανά.";
    },
  },
  locations: {
    delegate: () => db.pickupLocation as unknown as Delegate,
    schema: locationSchema,
    orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
    toDTO: (row) => jsonText(strip(row), ["name", "adjustmentLabel", "feeLabel"]),
    uniqueMessage: "Υπάρχει ήδη τοποθεσία με αυτό το slug",
    // Οι κρατήσεις του site (PR 3) θα δείχνουν σε τοποθεσίες· τότε η χρήση
    // θα ελέγχεται εδώ. Μέχρι τότε καμία δεν είναι «σε χρήση».
    inUse: async () => false,
    deactivate: { isActive: false },
  },
  promotions: {
    delegate: () => db.promotion as unknown as Delegate,
    schema: promotionSchema,
    orderBy: [{ sortOrder: "asc" }, { validFrom: "desc" }],
    toDTO: (row) => {
      const out = jsonText(strip(row), ["name", "badge"]);
      return { ...out, validFrom: isoDate(row.validFrom), validTo: isoDate(row.validTo) };
    },
    // Τοποθεσίες, ομάδες και οχήματα πρέπει να είναι της ΙΔΙΑΣ εταιρίας.
    check: async (companyId, data) => {
      const [locs, groups, vehicles] = await Promise.all([
        data.locationIds.length
          ? db.pickupLocation.count({ where: { tenantId: companyId, id: { in: data.locationIds } } })
          : 0,
        data.rentalGroupIds.length
          ? db.rentalGroup.count({ where: { tenantId: companyId, id: { in: data.rentalGroupIds } } })
          : 0,
        data.vehicleIds.length ? db.vehicle.count({ where: { tenantId: companyId, id: { in: data.vehicleIds } } }) : 0,
      ]);
      if (locs !== data.locationIds.length) return "Κάποια τοποθεσία δεν βρέθηκε";
      if (groups !== data.rentalGroupIds.length) return "Κάποια ομάδα δεν βρέθηκε";
      if (vehicles !== data.vehicleIds.length) return "Κάποιο όχημα δεν βρέθηκε";
      return null;
    },
  },
  seasons: {
    delegate: () => db.season as unknown as Delegate,
    schema: seasonSchema,
    orderBy: [{ sortOrder: "asc" }, { startMonthDay: "asc" }],
    toDTO: (row) => jsonText(strip(row), ["name"]),
  },
  "age-bands": {
    delegate: () => db.driverAgeBand as unknown as Delegate,
    schema: ageBandSchema,
    orderBy: [{ minAge: "asc" }],
    toDTO: (row) => jsonText(strip(row), ["label", "explanation"]),
    check: async (companyId, data, id) => {
      const clash = await db.driverAgeBand.findFirst({
        where: {
          tenantId: companyId,
          ...(id && { NOT: { id } }),
          minAge: { lte: data.maxAge },
          maxAge: { gte: data.minAge },
        },
        select: { minAge: true, maxAge: true },
      });
      return clash ? `Επικαλύπτεται με την ομάδα ηλικιών ${clash.minAge}–${clash.maxAge}` : null;
    },
    afterSave: async (companyId, row) => {
      if (!row.isDefault) return;
      await db.driverAgeBand.updateMany({
        where: { tenantId: companyId, isDefault: true, NOT: { id: row.id } },
        data: { isDefault: false },
      });
    },
  },
};

RESOURCES.places = {
  delegate: () => db.place as unknown as Delegate,
  schema: placeSchema,
  orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  include: { locations: { select: { pickupLocationId: true } } },
  toDTO: (row) => {
    const { locations, photos, detailsI18n, ...rest } = jsonText(strip(row), ["nameI18n", "shortI18n", "descriptionI18n"]);
    return {
      ...rest,
      detailsI18n: readPlaceDetails(detailsI18n),
      photos: toPhotoViews(readVehiclePhotos(photos)),
      locationIds: ((locations as { pickupLocationId: string }[] | undefined) ?? []).map((l) => l.pickupLocationId),
    };
  },
  toData: (data, mode) => placeToData(data, mode),
  uniqueMessage: "Υπάρχει ήδη μέρος με αυτό το slug",
  movable: true,
  // Οι τοποθεσίες πρέπει να είναι της ΙΔΙΑΣ εταιρίας.
  check: async (companyId, data) => {
    if (data.allLocations || data.locationIds.length === 0) return null;
    const n = await db.pickupLocation.count({ where: { tenantId: companyId, id: { in: data.locationIds } } });
    return n === data.locationIds.length ? null : "Κάποια τοποθεσία δεν βρέθηκε";
  },
  // Πρώτα οι φωτογραφίες από το Cloudinary· οι γραμμές place_locations
  // φεύγουν με το μέρος (ON DELETE CASCADE) — και ρητά εδώ, για σιγουριά.
  beforeDelete: async (companyId, id) => {
    const p = await db.place.findFirst({ where: { id, tenantId: companyId }, select: { photos: true } });
    const ok = await destroyPhotos(readVehiclePhotos(p?.photos));
    if (!ok) return "Οι φωτογραφίες του μέρους δεν σβήστηκαν από το Cloudinary. Δοκιμάστε ξανά.";
    await db.placeLocation.deleteMany({ where: { placeId: id, place: { tenantId: companyId } } });
    return null;
  },
};

RESOURCES.reviews = {
  delegate: () => db.review as unknown as Delegate,
  schema: reviewSchema,
  orderBy: [{ sortOrder: "asc" }, { reviewDate: "desc" }],
  toDTO: (row) => {
    const out = strip(row);
    return { ...out, text: readLocalized(row.text, 1500), reviewDate: isoDate(row.reviewDate) };
  },
  movable: true,
  check: async (companyId, data) => {
    if (!data.pickupLocationId) return null;
    const n = await db.pickupLocation.count({ where: { tenantId: companyId, id: data.pickupLocationId } });
    return n === 1 ? null : "Η τοποθεσία δεν βρέθηκε";
  },
};

export const isResource = (key: string): boolean => Object.prototype.hasOwnProperty.call(RESOURCES, key);
