// src/lib/storefront/siteUrl.ts
// ΤΟ σημείο που φτιάχνει ΚΑΘΕ απόλυτο URL του δημόσιου site (canonical,
// hreflang, Open Graph, sitemap, robots, schema.org) — καθαρή λογική.
//
// Σήμερα: <origin του αιτήματος>/s/<slug>/<lang>/…  (origin = το deployment
// που εξυπηρετεί τη σελίδα: preview ή production).
// Αργότερα (domain ανά εταιρία): ΜΟΝΟ εδώ θα αποφασίζεται αν η εταιρία έχει
// υποτομέα/custom domain και ποια μορφή παίρνει η διαδρομή — κανένα άλλο
// αρχείο δεν συνθέτει απόλυτα URL του site.

import { storefrontPath, type SitePath } from "./slug";

export interface SiteUrlCompany {
  slug: string;
}

export type SiteTarget =
  | { lang: string; page?: SitePath; query?: string }
  | { file: "sitemap.xml" | "robots.txt" };

/** Origin από τα headers του αιτήματος (Vercel: x-forwarded-host/proto). */
export function originFromHeaders(get: (name: string) => string | null): string | null {
  const host = (get("x-forwarded-host") ?? get("host"))?.split(",")[0].trim();
  if (!host || !/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) return null;
  const proto = (get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https")).split(",")[0].trim();
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

/** Απόλυτο URL μιας σελίδας ή αρχείου (sitemap/robots) της εταιρίας. */
export function buildSiteUrl(origin: string, company: SiteUrlCompany, target: SiteTarget): string {
  const path =
    "file" in target
      ? `/s/${company.slug}/${target.file}`
      : storefrontPath(company.slug, target.lang, target.page ?? "", target.query ?? "");
  return `${origin.replace(/\/+$/, "")}${path}`;
}
