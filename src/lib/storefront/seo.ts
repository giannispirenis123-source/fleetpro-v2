// src/lib/storefront/seo.ts
// SEO του δημόσιου site — καθαρή λογική (χωρίς db, χωρίς headers).
//
// · Τίτλος/περιγραφή: τα πεδία SEO του «Η σελίδα μου» ανά γλώσσα· κενά →
//   λογικές προεπιλογές από τα κείμενα της σελίδας.
// · canonical + hreflang (κάθε γλώσσα της εταιρίας + x-default = η
//   προεπιλεγμένη) — ΟΛΑ τα URL από ΜΙΑ συνάρτηση (siteUrl.ts), που δίνεται
//   εδώ ως `url(lang)`.
// · Open Graph / Twitter με τη φωτογραφία hero (ή το λογότυπο).
// · sitemap.xml / robots.txt / schema.org AutoRental.
//
// Ποτέ στο sitemap και πάντα noindex: search, book, booking, /c/, /pay.

import type { Metadata } from "next";
import type { PublicCompany } from "./publicData";
import { pickText } from "./settings";
import { fill, storefrontDictionary } from "./i18n";
import { textFor } from "../public/text";
import { cloudinaryThumb } from "../vehiclePhotos";
import { LEGAL_KINDS, legalLang, type LegalKind } from "../legal/legal";
import { TEMPLATE_UPDATED } from "../legal/templates";
import type { SitePath } from "./slug";

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;

/** Κόβει σε λέξη, με «…» αν χρειάστηκε. */
export function clip(text: string, max: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:—-]+$/, "")}…`;
}

/** Τίτλος της αρχικής χωρίς πεδίο SEO: «Τίτλος hero — Εταιρία» ή σκέτο το όνομα. */
export function defaultHomeTitle(company: PublicCompany, lang: string): string {
  const s = company.settings;
  const t = textFor(s.theme.heroTitle, lang) || pickText(s.title, lang, s.defaultLanguage);
  return t && t !== company.name ? `${t} — ${company.name}` : company.name;
}

export function homeSeoTitle(company: PublicCompany, lang: string): string {
  return clip(company.settings.seoTitle[lang] || defaultHomeTitle(company, lang), SEO_TITLE_MAX);
}

export function defaultHomeDescription(company: PublicCompany, lang: string): string {
  const s = company.settings;
  const own =
    textFor(s.theme.heroSubtitle, lang) || pickText(s.tagline, lang, s.defaultLanguage) || pickText(s.about, lang, s.defaultLanguage);
  if (own) return own;
  const d = storefrontDictionary(lang);
  return fill(d.seoDefaultDescription, { name: company.name, region: company.region ? ` — ${company.region}` : "" });
}

export function homeSeoDescription(company: PublicCompany, lang: string): string {
  return clip(company.settings.seoDescription[lang] || defaultHomeDescription(company, lang), SEO_DESCRIPTION_MAX);
}

/** Η εικόνα για Open Graph/Twitter: hero (1200px) → λογότυπο → καμία. */
export function socialImage(company: PublicCompany): { url: string; width?: number } | null {
  const hero = company.settings.theme.heroImage?.url;
  if (hero) return { url: cloudinaryThumb(hero, 1200), width: 1200 };
  return company.logoUrl ? { url: company.logoUrl } : null;
}

const OG_LOCALE: Record<string, string> = { el: "el_GR", en: "en_GB" };
const ogLocale = (lang: string) => OG_LOCALE[lang] ?? lang;

export interface PageSeo {
  company: PublicCompany;
  lang: string;
  title: string;
  description?: string | null;
  /** Απόλυτο URL της ΙΔΙΑΣ σελίδας σε μια γλώσσα (από το siteUrl). */
  url: (lang: string) => string;
  image?: { url: string; width?: number } | null;
  type?: "website" | "article";
}

/** canonical + hreflang (+ x-default) για τις γλώσσες της εταιρίας. */
export function alternatesFor(company: PublicCompany, lang: string, url: (lang: string) => string): Metadata["alternates"] {
  const { supportedLanguages, defaultLanguage } = company.settings;
  return {
    canonical: url(lang),
    languages: {
      ...Object.fromEntries(supportedLanguages.map((l) => [l, url(l)])),
      "x-default": url(defaultLanguage),
    },
  };
}

/** Πλήρη metadata μιας σελίδας που ΜΠΑΙΝΕΙ στο ευρετήριο. */
export function indexablePage(p: PageSeo): Metadata {
  const description = p.description ? clip(p.description, SEO_DESCRIPTION_MAX) : undefined;
  const image = p.image === undefined ? socialImage(p.company) : p.image;
  const images = image ? [image] : undefined;
  const others = p.company.settings.supportedLanguages.filter((l) => l !== p.lang).map(ogLocale);
  return {
    title: { absolute: p.title },
    description,
    keywords: null,
    alternates: alternatesFor(p.company, p.lang, p.url),
    openGraph: {
      type: p.type ?? "website",
      title: p.title,
      description,
      url: p.url(p.lang),
      siteName: p.company.name,
      locale: ogLocale(p.lang),
      ...(others.length ? { alternateLocale: others } : {}),
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: p.title,
      description,
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
    robots: { index: true, follow: true },
  };
}

/** Σελίδες εκτός ευρετηρίου (αναζήτηση, κράτηση, επιβεβαίωση, παλιά σελίδα οχήματος). */
export function noindexPage(title: string, extra: Metadata = {}): Metadata {
  return { title: { absolute: title }, description: null, keywords: null, robots: { index: false, follow: false }, ...extra };
}

/* ─────────────────────────────────────────────
   sitemap.xml / robots.txt
   ───────────────────────────────────────────── */

export interface SitemapEntry {
  /** Ανά γλώσσα της εταιρίας → απόλυτο URL (όλες γίνονται εναλλακτικές hreflang). */
  urls: Record<string, string>;
  /** Ανά γλώσσα → YYYY-MM-DD. */
  lastmod?: Record<string, string>;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Ένα <url> ανά γλώσσα, με όλες τις εναλλακτικές (xhtml:link hreflang) + x-default. */
export function sitemapXml(entries: SitemapEntry[], defaultLanguage: string): string {
  const rows: string[] = [];
  for (const e of entries) {
    const langs = Object.keys(e.urls);
    const alt = [
      ...langs.map((l) => `    <xhtml:link rel="alternate" hreflang="${xmlEscape(l)}" href="${xmlEscape(e.urls[l])}"/>`),
      ...(e.urls[defaultLanguage] ? [`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(e.urls[defaultLanguage])}"/>`] : []),
    ];
    for (const l of langs) {
      const lastmod = e.lastmod?.[l];
      rows.push(
        [
          "  <url>",
          `    <loc>${xmlEscape(e.urls[l])}</loc>`,
          ...(lastmod ? [`    <lastmod>${xmlEscape(lastmod)}</lastmod>`] : []),
          ...alt,
          "  </url>",
        ].join("\n")
      );
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...rows,
    "</urlset>",
    "",
  ].join("\n");
}

/** Τι μπαίνει στο sitemap: ΜΟΝΟ αρχική, ενεργά μέρη και νομικά (ποτέ search/book/booking). */
export interface SitemapData {
  places: { slug: string; updated: string }[];
  /** Τελευταία αποθήκευση της εταιρίας ανά (είδος, γλώσσα κειμένου)· χωρίς = πρότυπο. */
  legal: Partial<Record<LegalKind, Record<string, string>>>;
}

export function buildSitemap(company: PublicCompany, data: SitemapData, url: (lang: string, page: SitePath) => string): string {
  const langs = company.settings.supportedLanguages;
  const entry = (page: SitePath, lastmod?: (lang: string) => string): SitemapEntry => ({
    urls: Object.fromEntries(langs.map((l) => [l, url(l, page)])),
    ...(lastmod ? { lastmod: Object.fromEntries(langs.map((l) => [l, lastmod(l)])) } : {}),
  });
  return sitemapXml(
    [
      entry(""),
      ...data.places.map((p) => entry({ placeSlug: p.slug }, () => p.updated)),
      ...LEGAL_KINDS.map((k) => entry(k, (l) => data.legal[k]?.[legalLang(l)] ?? TEMPLATE_UPDATED)),
    ],
    company.settings.defaultLanguage
  );
}

/** robots.txt μιας εταιρίας. Δεν «κρύβει» search/book/booking: αυτά είναι noindex (για να το δει η Google, πρέπει να μπορεί να τα διαβάσει). */
export function robotsTxt(siteRoot: string, sitemapUrl: string): string {
  const path = new URL(siteRoot).pathname.replace(/\/?$/, "/");
  return ["User-agent: *", `Allow: ${path}`, "", `Sitemap: ${sitemapUrl}`, ""].join("\n");
}

/* ─────────────────────────────────────────────
   schema.org — AutoRental στην αρχική
   ───────────────────────────────────────────── */

export interface BusinessJsonLdInput {
  company: PublicCompany;
  url: string;
  /** Διεύθυνση/τηλέφωνο/email όπως φαίνονται στο site (contactOf). */
  contact: { phone: string | null; email: string | null; address: string | null };
  /** Ενεργές τοποθεσίες παραλαβής (όνομα στη γλώσσα της σελίδας, διεύθυνση, συντεταγμένες). */
  locations: { name: string; address: string | null; lat: number | null; lng: number | null }[];
  /** Το AggregateRating των κριτικών (loadReviewSection) — μένει ΑΚΡΙΒΩΣ όπως είναι. */
  reviewsJsonLd: Record<string, unknown> | null;
}

/**
 * Ώρες λειτουργίας: ό,τι είναι ΕΚΤΟΣ της «χρέωσης εκτός ωραρίου» (π.χ.
 * εκτός 23:00–07:00 → 07:00–23:00, όλες τις ημέρες).
 */
export function openingHours(afterHours: { start: string; end: string }): Record<string, unknown> | null {
  if (!afterHours.start || !afterHours.end || afterHours.start === afterHours.end) return null;
  return {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    opens: afterHours.end,
    closes: afterHours.start,
  };
}

export function businessJsonLd(i: BusinessJsonLdInput): Record<string, unknown> {
  const { company, contact } = i;
  const image = socialImage(company);
  const hours = openingHours(company.settings.booking.afterHours);
  const places = i.locations.map((l) => ({
    "@type": "Place",
    name: l.name,
    ...(l.address ? { address: l.address } : {}),
    ...(l.lat !== null && l.lng !== null ? { geo: { "@type": "GeoCoordinates", latitude: l.lat, longitude: l.lng } } : {}),
  }));
  const rating = i.reviewsJsonLd?.aggregateRating;
  return {
    "@context": "https://schema.org",
    "@type": "AutoRental",
    name: company.name,
    url: i.url,
    ...(company.logoUrl ? { logo: company.logoUrl } : {}),
    ...(image ? { image: image.url } : {}),
    ...(contact.phone ? { telephone: contact.phone } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: contact.address,
            ...(company.region ? { addressRegion: company.region } : {}),
          },
        }
      : {}),
    ...(hours ? { openingHoursSpecification: [hours] } : {}),
    ...(places.length ? { areaServed: places } : {}),
    ...(rating ? { aggregateRating: rating } : {}),
  };
}

/** JSON για <script type="application/ld+json"> — «<» διαφυγή (κανένα </script> από δεδομένα). */
export const jsonLdText = (data: Record<string, unknown>) => JSON.stringify(data).replace(/</g, "\\u003c");
