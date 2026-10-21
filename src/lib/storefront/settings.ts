// src/lib/storefront/settings.ts
// Ρυθμίσεις της δημόσιας σελίδας (tenants."storefrontSettings", JSONB) —
// καθαρή λογική + zod (χωρίς db), για server, client και tests.
//
// Σχήμα στη βάση:
// {
//   "title":   {"el":"…","en":"…"},   ← κείμενα ανά ΚΩΔΙΚΟ γλώσσας,
//   "tagline": {"el":"…","en":"…"},     όχι στήλες ανά γλώσσα
//   "about":   {"el":"…","en":"…"},
//   "seoTitle": {"el":"…"}, "seoDescription": {"el":"…"},   ← SEO (PR SEO/νομικά)
//   "supportedLanguages": ["el","en"],
//   "defaultLanguage": "el",
//   "paymentOptions": {"onPickup":true,"online":false},
//   "booking": {…}, "contact": {…}, "theme": {…}, "trustBlocks": [...]   ← SQL 21,
//                                       βλ. src/lib/public/siteSettings.ts
// }
// Το παλιό "bookingMode" ΚΑΤΑΡΓΗΘΗΚΕ (SQL 21 το σβήνει): ο τρόπος κράτησης
// ζει μόνο στο tenants."rentalMode".
// Ό,τι λείπει ή είναι άκυρο παίρνει την προεπιλογή — το site δεν σκάει ποτέ
// από χαλασμένο JSON.

import { z } from "zod";
import { STOREFRONT_LANGUAGES, isStorefrontLanguage } from "./i18n";
import {
  readBooking,
  readContact,
  readTheme,
  readTrustBlocks,
  type BookingSettings,
  type ContactSettings,
  type SiteSettingsUpdate,
  type ThemeSettings,
  type TrustBlock,
} from "../public/siteSettings";

export const TEXT_FIELDS = ["title", "tagline", "about", "seoTitle", "seoDescription"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
export type LocalizedText = Record<string, string>;

export const TEXT_MAX: Record<TextField, number> = { title: 80, tagline: 160, about: 2000, seoTitle: 70, seoDescription: 160 };

export const DEFAULT_LANGUAGES = ["el", "en"];
export const DEFAULT_LANGUAGE = "el";

export interface StorefrontSettings {
  title: LocalizedText;
  tagline: LocalizedText;
  about: LocalizedText;
  /** SEO ανά γλώσσα (κενό = προεπιλογή από τα κείμενα της σελίδας, seo.ts). */
  seoTitle: LocalizedText;
  seoDescription: LocalizedText;
  supportedLanguages: string[];
  defaultLanguage: string;
  /** online: ΠΑΝΤΑ false μέχρι να υπάρξουν πληρωμές («σύντομα»). */
  paymentOptions: { onPickup: boolean; online: boolean };
  booking: BookingSettings;
  contact: ContactSettings;
  theme: ThemeSettings;
  trustBlocks: TrustBlock[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function readText(value: unknown, field: TextField): LocalizedText {
  if (!isObject(value)) return {};
  const out: LocalizedText = {};
  for (const [lang, text] of Object.entries(value)) {
    if (!isStorefrontLanguage(lang) || typeof text !== "string") continue;
    const trimmed = text.trim().slice(0, TEXT_MAX[field]);
    if (trimmed) out[lang] = trimmed;
  }
  return out;
}

export function normalizeStorefrontSettings(raw: unknown): StorefrontSettings {
  const o = isObject(raw) ? raw : {};

  let languages = Array.isArray(o.supportedLanguages)
    ? Array.from(new Set(o.supportedLanguages.filter(isStorefrontLanguage)))
    : [];
  if (languages.length === 0) languages = DEFAULT_LANGUAGES.filter(isStorefrontLanguage);

  const defaultLanguage =
    isStorefrontLanguage(o.defaultLanguage) && languages.includes(o.defaultLanguage)
      ? o.defaultLanguage
      : languages.includes(DEFAULT_LANGUAGE)
        ? DEFAULT_LANGUAGE
        : languages[0];

  const pay = isObject(o.paymentOptions) ? o.paymentOptions : {};

  return {
    title: readText(o.title, "title"),
    tagline: readText(o.tagline, "tagline"),
    about: readText(o.about, "about"),
    seoTitle: readText(o.seoTitle, "seoTitle"),
    seoDescription: readText(o.seoDescription, "seoDescription"),
    supportedLanguages: languages,
    defaultLanguage,
    paymentOptions: { onPickup: pay.onPickup !== false, online: false },
    booking: readBooking(o.booking),
    contact: readContact(o.contact),
    theme: readTheme(o.theme),
    trustBlocks: readTrustBlocks(o.trustBlocks),
  };
}

/** Κείμενο στη ζητούμενη γλώσσα → στην προεπιλεγμένη → κενό. */
export function pickText(text: LocalizedText, lang: string, fallbackLang: string): string {
  return text[lang] || text[fallbackLang] || "";
}

/* ─────────────────────────────────────────────
   «Η σελίδα μου» — σώμα του PATCH /api/storefront
   ───────────────────────────────────────────── */

const textMap = (field: TextField) =>
  z.record(z.string(), z.string().max(TEXT_MAX[field], "Πολύ μεγάλο κείμενο")).optional();

export const storefrontUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  /** "" = αφαίρεση slug (και τότε η σελίδα δεν μπορεί να είναι ενεργή). */
  slug: z.string().max(80).optional(),
  title: textMap("title"),
  tagline: textMap("tagline"),
  about: textMap("about"),
  seoTitle: textMap("seoTitle"),
  seoDescription: textMap("seoDescription"),
  supportedLanguages: z
    .array(z.string())
    .min(1, "Διαλέξτε τουλάχιστον μία γλώσσα")
    .refine((l) => l.every(isStorefrontLanguage), "Μη υποστηριζόμενη γλώσσα")
    .optional(),
  defaultLanguage: z
    .string()
    .refine(isStorefrontLanguage, "Μη υποστηριζόμενη γλώσσα")
    .optional(),
  payOnPickup: z.boolean().optional(),
});

export type StorefrontUpdate = z.infer<typeof storefrontUpdateSchema>;

/** Νέες ρυθμίσεις = τρέχουσες + ό,τι ήρθε (ξανα-κανονικοποιημένες). */
export function mergeStorefrontSettings(
  current: StorefrontSettings,
  update: StorefrontUpdate
): StorefrontSettings {
  return normalizeStorefrontSettings({
    ...current,
    ...(update.title && { title: update.title }),
    ...(update.tagline && { tagline: update.tagline }),
    ...(update.about && { about: update.about }),
    ...(update.seoTitle && { seoTitle: update.seoTitle }),
    ...(update.seoDescription && { seoDescription: update.seoDescription }),
    ...(update.supportedLanguages && { supportedLanguages: update.supportedLanguages }),
    ...(update.defaultLanguage && { defaultLanguage: update.defaultLanguage }),
    paymentOptions: {
      onPickup: update.payOnPickup ?? current.paymentOptions.onPickup,
      online: false,
    },
  });
}

/**
 * «Η σελίδα μου» → καρτέλες του δημόσιου site (PATCH /api/public-site/settings):
 * τρέχουσες + ό,τι ήρθε, ανά ενότητα. Το heroImage δεν αλλάζει από εδώ
 * (μόνο από το API φωτογραφίας).
 */
export function mergeSiteSettings(
  current: StorefrontSettings,
  update: SiteSettingsUpdate
): StorefrontSettings {
  return normalizeStorefrontSettings({
    ...current,
    paymentOptions: {
      onPickup: update.payOnPickup ?? current.paymentOptions.onPickup,
      online: false,
    },
    booking: { ...current.booking, ...update.booking },
    contact: { ...current.contact, ...update.contact },
    theme: { ...current.theme, ...update.theme, heroImage: current.theme.heroImage },
    trustBlocks: update.trustBlocks ?? current.trustBlocks,
  });
}

export { STOREFRONT_LANGUAGES };
