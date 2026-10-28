// src/lib/public/siteSettings.ts
// Ρυθμίσεις κρατήσεων / επικοινωνίας / εμφάνισης / εμπιστοσύνης του δημόσιου
// site — ΜΕΣΑ στο υπάρχον tenants."storefrontSettings" (JSONB), όχι νέες στήλες.
//
//   booking:     holdHours, minLeadHours, maxAdvanceDays, graceMinutes,
//                defaultPickupTime/DropoffTime, defaultRentalDays,
//                afterHours {start, end, feeCents}, oneWayFeeCents,
//                noDepositRequired, timezone
//   contact:     phone, whatsapp, viber, email, address, mapUrl
//   theme:       accentColor, heroImage {url, publicId}, heroTitle, heroSubtitle, cornerStyle
//   trustBlocks: [{ icon, title, text }] (έως 6)
//
// ΔΕΝ ζουν εδώ (μία πηγή αλήθειας):
//   · τρόπος κράτησης → tenants."rentalMode" (BOOKING = απευθείας, REQUEST = αίτημα)
//   · ΦΠΑ            → tenants."vatRate"
//   · κύριο χρώμα / λογότυπο → tenants."brandColor" / "logoPath" (Ρυθμίσεις, Super Admin)
//   · πληρωμή        → storefrontSettings.paymentOptions (υπήρχε από το SQL 20)
//
// Καθαρή λογική + zod: server, client και tests.

import { z } from "zod";
import { isStorefrontLanguage } from "../storefront/i18n";
import type { LocalizedText } from "./text";

/* ─────────────────────────────────────────────
   Τύποι + προεπιλογές
   ───────────────────────────────────────────── */

export interface BookingSettings {
  /** Ώρες που «κρατιέται» ένα αίτημα (μόνο σε rentalMode = REQUEST). */
  holdHours: number;
  minLeadHours: number;
  maxAdvanceDays: number;
  graceMinutes: number;
  defaultPickupTime: string;
  defaultDropoffTime: string;
  defaultRentalDays: number;
  afterHours: { start: string; end: string; feeCents: number };
  oneWayFeeCents: number | null;
  noDepositRequired: boolean;
  timezone: string;
}

export interface ContactSettings {
  phone: string;
  whatsapp: string;
  viber: string;
  email: string;
  address: string;
  mapUrl: string;
}

export const CORNER_STYLES = ["rounded", "pill"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];

export interface ThemeSettings {
  /** Δεύτερο χρώμα· το κύριο είναι το brandColor της εταιρίας. */
  accentColor: string | null;
  /** publicId μόνο στον server (διαγραφή από το Cloudinary)· στο δημόσιο λείπει. */
  heroImage: { url: string; publicId?: string | null } | null;
  heroTitle: LocalizedText;
  heroSubtitle: LocalizedText;
  cornerStyle: CornerStyle;
}

export interface TrustBlock {
  icon: string;
  title: LocalizedText;
  text: LocalizedText;
}

export const MAX_TRUST_BLOCKS = 6;

/** Εικονίδια lucide-react που επιτρέπονται στις ενότητες εμπιστοσύνης. */
export const TRUST_ICONS = [
  "ShieldCheck", "BadgeEuro", "Wallet", "CreditCard", "Ban", "Plane", "Ship", "MapPin",
  "Navigation", "Clock", "MoonStar", "Sun", "CarFront", "Bike", "KeyRound", "Fuel",
  "Headphones", "Phone", "ThumbsUp", "Star", "Award", "Sparkles", "Heart", "Umbrella",
  "Baby", "UserPlus",
] as const;

export const TIMEZONES = ["Europe/Athens", "Europe/Nicosia", "Europe/London", "Europe/Berlin", "Europe/Rome"] as const;

export const DEFAULT_BOOKING: BookingSettings = {
  holdHours: 24,
  minLeadHours: 3,
  maxAdvanceDays: 365,
  graceMinutes: 59,
  defaultPickupTime: "10:00",
  defaultDropoffTime: "10:00",
  // Προεπιλεγμένη διάρκεια στο site (αρχική, αναζήτηση, κράτηση): 1 ημέρα· το
  // minDays της σεζόν την ανεβάζει (defaultCriteria). Η εταιρία την αλλάζει στις Ρυθμίσεις.
  defaultRentalDays: 1,
  afterHours: { start: "23:00", end: "07:00", feeCents: 0 },
  oneWayFeeCents: null,
  noDepositRequired: false,
  timezone: "Europe/Athens",
};

export const DEFAULT_CONTACT: ContactSettings = {
  phone: "", whatsapp: "", viber: "", email: "", address: "", mapUrl: "",
};

export const DEFAULT_THEME: ThemeSettings = {
  accentColor: null,
  heroImage: null,
  heroTitle: {},
  heroSubtitle: {},
  cornerStyle: "pill",
};

/* ─────────────────────────────────────────────
   Ανάγνωση από JSON (ανεκτική: άκυρο → προεπιλογή)
   ───────────────────────────────────────────── */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const int = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : def;
const time = (v: unknown, def: string): string => (typeof v === "string" && TIME_RE.test(v) ? v : def);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Κείμενο ανά γλώσσα — μόνο γλώσσες που υποστηρίζει το site. */
export function readSiteText(value: unknown, max: number): LocalizedText {
  if (!isObject(value)) return {};
  const out: LocalizedText = {};
  for (const [lang, text] of Object.entries(value)) {
    if (!isStorefrontLanguage(lang) || typeof text !== "string") continue;
    const s = text.trim().slice(0, max);
    if (s) out[lang] = s;
  }
  return out;
}

export function readBooking(raw: unknown): BookingSettings {
  const o = isObject(raw) ? raw : {};
  const ah = isObject(o.afterHours) ? o.afterHours : {};
  const d = DEFAULT_BOOKING;
  return {
    holdHours: int(o.holdHours, d.holdHours, 1, 168),
    minLeadHours: int(o.minLeadHours, d.minLeadHours, 0, 720),
    maxAdvanceDays: int(o.maxAdvanceDays, d.maxAdvanceDays, 1, 730),
    graceMinutes: int(o.graceMinutes, d.graceMinutes, 0, 240),
    defaultPickupTime: time(o.defaultPickupTime, d.defaultPickupTime),
    defaultDropoffTime: time(o.defaultDropoffTime, d.defaultDropoffTime),
    defaultRentalDays: int(o.defaultRentalDays, d.defaultRentalDays, 1, 60),
    afterHours: {
      start: time(ah.start, d.afterHours.start),
      end: time(ah.end, d.afterHours.end),
      feeCents: int(ah.feeCents, d.afterHours.feeCents, 0, 1_000_000),
    },
    oneWayFeeCents: int(o.oneWayFeeCents, -1, 0, 1_000_000) >= 0 ? (o.oneWayFeeCents as number) : null,
    noDepositRequired: o.noDepositRequired === true,
    timezone: typeof o.timezone === "string" && (TIMEZONES as readonly string[]).includes(o.timezone) ? o.timezone : d.timezone,
  };
}

export function readContact(raw: unknown): ContactSettings {
  const o = isObject(raw) ? raw : {};
  const url = str(o.mapUrl, 500);
  return {
    phone: str(o.phone, 40),
    whatsapp: str(o.whatsapp, 40),
    viber: str(o.viber, 40),
    email: str(o.email, 120),
    address: str(o.address, 200),
    mapUrl: /^https:\/\//.test(url) ? url : "",
  };
}

export function readTheme(raw: unknown): ThemeSettings {
  const o = isObject(raw) ? raw : {};
  const img = isObject(o.heroImage) ? o.heroImage : null;
  return {
    accentColor: typeof o.accentColor === "string" && HEX_RE.test(o.accentColor) ? o.accentColor : null,
    heroImage:
      img && typeof img.url === "string" && /^https:\/\//.test(img.url)
        ? { url: img.url, publicId: typeof img.publicId === "string" ? img.publicId : null }
        : null,
    heroTitle: readSiteText(o.heroTitle, 120),
    heroSubtitle: readSiteText(o.heroSubtitle, 240),
    cornerStyle: o.cornerStyle === "rounded" ? "rounded" : "pill",
  };
}

export function readTrustBlocks(raw: unknown): TrustBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .map((b) => ({
      icon: (TRUST_ICONS as readonly string[]).includes(String(b.icon)) ? String(b.icon) : "ShieldCheck",
      title: readSiteText(b.title, 80),
      text: readSiteText(b.text, 300),
    }))
    .filter((b) => Object.keys(b.title).length > 0)
    .slice(0, MAX_TRUST_BLOCKS);
}

/* ─────────────────────────────────────────────
   PATCH /api/public-site/settings — zod
   ───────────────────────────────────────────── */

const textMap = (max: number) => z.record(z.string(), z.string().max(max, "Πολύ μεγάλο κείμενο"));
const cents = z.number().int().min(0, "Το ποσό δεν μπορεί να είναι αρνητικό").max(1_000_000);
const timeField = z.string().regex(TIME_RE, "Ώρα σε μορφή ΩΩ:ΛΛ");

export const siteSettingsUpdateSchema = z.object({
  /** Ο τρόπος κράτησης γράφεται στο tenants.rentalMode — ΕΝΑ σημείο. */
  rentalMode: z.enum(["BOOKING", "REQUEST"]).optional(),
  payOnPickup: z.boolean().optional(),
  booking: z
    .object({
      holdHours: z.number().int().min(1, "Τουλάχιστον 1 ώρα").max(168, "Έως 168 ώρες"),
      minLeadHours: z.number().int().min(0).max(720),
      maxAdvanceDays: z.number().int().min(1).max(730),
      graceMinutes: z.number().int().min(0).max(240, "Έως 240 λεπτά"),
      defaultPickupTime: timeField,
      defaultDropoffTime: timeField,
      defaultRentalDays: z.number().int().min(1).max(60),
      afterHours: z.object({ start: timeField, end: timeField, feeCents: cents }),
      oneWayFeeCents: cents.nullable(),
      noDepositRequired: z.boolean(),
      timezone: z.enum(TIMEZONES),
    })
    .partial()
    .optional(),
  contact: z
    .object({
      phone: z.string().max(40),
      whatsapp: z.string().max(40),
      viber: z.string().max(40),
      email: z.union([z.literal(""), z.string().email("Μη έγκυρο email")]),
      address: z.string().max(200),
      mapUrl: z.union([z.literal(""), z.string().url("Μη έγκυρο link").startsWith("https://", "Το link πρέπει να ξεκινά με https://")]),
    })
    .partial()
    .optional(),
  theme: z
    .object({
      accentColor: z.union([z.null(), z.string().regex(HEX_RE, "Χρώμα σε μορφή #RRGGBB")]),
      heroTitle: textMap(120),
      heroSubtitle: textMap(240),
      cornerStyle: z.enum(CORNER_STYLES),
    })
    .partial()
    .optional(),
  trustBlocks: z
    .array(
      z.object({
        icon: z.enum(TRUST_ICONS),
        title: textMap(80).refine((t) => Object.values(t).some((v) => v.trim()), "Ο τίτλος (ΕΛ) είναι υποχρεωτικός"),
        text: textMap(300),
      })
    )
    .max(MAX_TRUST_BLOCKS, `Έως ${MAX_TRUST_BLOCKS} ενότητες`)
    .optional(),
});

export type SiteSettingsUpdate = z.infer<typeof siteSettingsUpdateSchema>;
