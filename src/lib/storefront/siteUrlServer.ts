// src/lib/storefront/siteUrlServer.ts
// siteUrl() — το απόλυτο URL του δημόσιου site για το τρέχον αίτημα. ΜΟΝΟ server.
// Η λογική ζει στο siteUrl.ts (buildSiteUrl)· εδώ μόνο το origin του αιτήματος.

import { headers } from "next/headers";
import { buildSiteUrl, originFromHeaders, type SiteTarget, type SiteUrlCompany } from "./siteUrl";

export function requestOrigin(): string {
  const h = headers();
  return originFromHeaders((n) => h.get(n)) ?? "";
}

export function siteUrl(company: SiteUrlCompany, target: SiteTarget): string {
  return buildSiteUrl(requestOrigin(), company, target);
}
