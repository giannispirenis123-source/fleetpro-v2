// src/lib/storefront/seoServer.ts
// Δεδομένα για SEO (sitemap, schema.org) — ΜΟΝΟ server. Κάθε ερώτημα με το
// companyId που έδωσε το resolveStorefrontCompany· μόνο δημόσια πεδία.

import { db } from "../db";
import { textFor, type LocalizedText } from "../public/text";
import type { LegalKind } from "../legal/legal";
import type { SitemapData } from "./seo";

/** Ενεργές τοποθεσίες για το AutoRental (όνομα στη γλώσσα της σελίδας). */
export async function loadSeoLocations(companyId: string, lang: string) {
  const rows = await db.pickupLocation.findMany({
    where: { tenantId: companyId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
    select: { slug: true, name: true, address: true, lat: true, lng: true },
  });
  return rows.map((l) => ({
    name: textFor(l.name as LocalizedText, lang) || l.slug,
    address: l.address?.trim() || null,
    lat: typeof l.lat === "number" ? l.lat : null,
    lng: typeof l.lng === "number" ? l.lng : null,
  }));
}

export async function loadSitemapData(companyId: string): Promise<SitemapData> {
  const [places, legalRows] = await Promise.all([
    db.place.findMany({
      where: { tenantId: companyId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
      select: { slug: true, updatedAt: true },
    }),
    db.siteLegalText.findMany({
      where: { tenantId: companyId },
      orderBy: { version: "desc" },
      distinct: ["kind", "lang"],
      select: { kind: true, lang: true, createdAt: true },
    }),
  ]);
  const legal: SitemapData["legal"] = {};
  for (const r of legalRows) {
    const k = r.kind as LegalKind;
    (legal[k] ??= {})[r.lang] = r.createdAt.toISOString().slice(0, 10);
  }
  return { places: places.map((p) => ({ slug: p.slug, updated: p.updatedAt.toISOString().slice(0, 10) })), legal };
}
