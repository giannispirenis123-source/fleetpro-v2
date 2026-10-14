// src/lib/storefront/publicData.ts
// Τι ΒΓΑΙΝΕΙ στη δημόσια σελίδα — καθαρή λογική, χωρίς db.
//
// Λίστα ΕΠΙΤΡΕΠΟΜΕΝΩΝ (whitelist), όχι απαγορευμένων: κάθε πεδίο γράφεται
// ρητά. Ένα νέο πεδίο στο Tenant/Vehicle (π.χ. IBAN, πινακίδα, χιλιόμετρα,
// σημειώσεις) ΔΕΝ φτάνει ποτέ στο site αν δεν προστεθεί συνειδητά εδώ.
// Πελάτες, κρατήσεις, συμβόλαια, τιμολόγια, κάρτες: δεν διαβάζονται καν.

import { readVehiclePhotos } from "../vehiclePhotos";
import { normalizeStorefrontSettings, type StorefrontSettings } from "./settings";

export interface PublicCompany {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  region: string | null;
  /** Τρόπος κράτησης — ΜΟΝΗ πηγή: tenants.rentalMode (BOOKING = απευθείας, REQUEST = αίτημα). */
  rentalMode: "BOOKING" | "REQUEST";
  settings: StorefrontSettings;
}

export interface PublicVehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  category: string;
  fuel: string;
  seats: number;
  doors: number;
  transmission: string;
  ac: boolean;
  /** Τιμή ημέρας ΜΕ ΦΠΑ (οι τιμές των οχημάτων περιέχουν ήδη ΦΠΑ). */
  dailyRate: number;
  /** Μόνο URLs, με τη σειρά· η πρώτη είναι η κύρια. */
  photos: string[];
}

const DEFAULT_BRAND = "#2563EB";
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Μόνο έγκυρο #RRGGBB περνά σε CSS — τίποτα άλλο δεν μπαίνει σε style. */
export const safeBrandColor = (c: unknown): string =>
  typeof c === "string" && HEX_RE.test(c) ? c : DEFAULT_BRAND;

/** Ό,τι εσωτερικό υπάρχει στις ρυθμίσεις (publicId του Cloudinary) φεύγει. */
function publicSettings(s: StorefrontSettings): StorefrontSettings {
  return {
    ...s,
    theme: { ...s.theme, heroImage: s.theme.heroImage ? { url: s.theme.heroImage.url } : null },
  };
}

export interface CompanySource {
  storefrontSlug: string | null;
  name: string;
  brandColor: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  region: string | null;
  rentalMode?: string | null;
  storefrontSettings: unknown;
}

export function toPublicCompany(t: CompanySource, logoUrl: string | null): PublicCompany {
  return {
    slug: t.storefrontSlug ?? "",
    name: t.name,
    logoUrl,
    brandColor: safeBrandColor(t.brandColor),
    phone: t.phone || null,
    email: t.email || null,
    address: t.address || null,
    region: t.region || null,
    rentalMode: t.rentalMode === "REQUEST" ? "REQUEST" : "BOOKING",
    settings: publicSettings(normalizeStorefrontSettings(t.storefrontSettings)),
  };
}

export interface VehicleSource {
  id: string;
  brand: string;
  model: string;
  year: number;
  category: string;
  fuel: string;
  seats: number;
  doors: number;
  transmission: string;
  ac: boolean;
  dailyRate: unknown; // Prisma Decimal
  photos: unknown;
}

export function toPublicVehicle(v: VehicleSource): PublicVehicle {
  return {
    id: v.id,
    brand: v.brand,
    model: v.model,
    year: v.year,
    category: v.category,
    fuel: v.fuel,
    seats: v.seats,
    doors: v.doors,
    transmission: v.transmission,
    ac: v.ac,
    dailyRate: Number(v.dailyRate),
    photos: readVehiclePhotos(v.photos).map((p) => p.url),
  };
}

/**
 * Τα ΜΟΝΑ πεδία που διαβάζονται από τη βάση για το site (Prisma select).
 * Ό,τι δεν είναι εδώ δεν φεύγει καν από τη βάση.
 */
export const PUBLIC_VEHICLE_SELECT = {
  id: true,
  brand: true,
  model: true,
  year: true,
  category: true,
  fuel: true,
  seats: true,
  doors: true,
  transmission: true,
  ac: true,
  dailyRate: true,
  photos: true,
} as const;
