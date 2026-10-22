// src/lib/storefront/siteUrl.ts
// ΤΟ σημείο που φτιάχνει ΚΑΘΕ απόλυτο URL του δημόσιου site (canonical,
// hreflang, Open Graph, sitemap, robots, schema.org, links σε email και
// επιστροφή από το Stripe) — καθαρή λογική.
//
// Εταιρία με VERIFIED domain (siteDomain): ΠΑΝΤΑ https://<domain>/<lang>/…,
// ακόμη κι όταν η σελίδα σερβίρεται από το /s/<slug> (canonical προς το domain).
// Χωρίς domain: <origin του αιτήματος>/s/<slug>/<lang>/… όπως πριν (origin =
// το deployment που εξυπηρετεί τη σελίδα: preview ή production).
// Κανένα άλλο αρχείο δεν συνθέτει απόλυτα URL του site.

import { normalizeHost } from "./domain";
import { sitePath, storefrontPath, type SitePath } from "./slug";

export interface SiteUrlCompany {
  slug: string;
  /** Το VERIFIED domain της εταιρίας (π.χ. "www.helios-rent.gr") ή null. */
  siteDomain?: string | null;
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

/** Το VERIFIED domain ως origin (https), ή null αν δεν υπάρχει/δεν είναι έγκυρο. */
export function domainOrigin(company: SiteUrlCompany): string | null {
  const host = normalizeHost(company.siteDomain ?? null);
  return host ? `https://${host}` : null;
}

/** Απόλυτο URL μιας σελίδας ή αρχείου (sitemap/robots) της εταιρίας. */
export function buildSiteUrl(origin: string, company: SiteUrlCompany, target: SiteTarget): string {
  const domain = domainOrigin(company);
  if (domain) {
    const path =
      "file" in target
        ? `/${target.file}`
        : sitePath({ slug: company.slug, basePath: "" }, target.lang, target.page ?? "", target.query ?? "");
    return `${domain}${path}`;
  }
  const path =
    "file" in target
      ? `/s/${company.slug}/${target.file}`
      : storefrontPath(company.slug, target.lang, target.page ?? "", target.query ?? "");
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/**
 * Η βάση των σχετικών links για ένα αίτημα που έφτασε στο `origin`: "" αν
 * είναι το VERIFIED domain της εταιρίας, αλλιώς /s/<slug>. (Για ροές που
 * μένουν στο ίδιο host, π.χ. η μετάβαση στη σελίδα επιβεβαίωσης.)
 */
export function basePathForOrigin(origin: string, company: SiteUrlCompany): string {
  let host: string | null = null;
  try {
    host = normalizeHost(new URL(origin).host);
  } catch {
    host = null;
  }
  const domain = normalizeHost(company.siteDomain ?? null);
  return domain && host === domain ? "" : `/s/${company.slug}`;
}
