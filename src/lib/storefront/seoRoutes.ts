// src/lib/storefront/seoRoutes.ts
// sitemap.xml / robots.txt ανά εταιρία — ΜΟΝΟ server. Η εταιρία ΜΟΝΟ από το
// slug (resolveStorefrontCompany): ανενεργή ή άγνωστη → ίδιο 404, χωρίς στοιχεία.

import { resolveStorefrontCompany } from "./resolve";
import { siteUrl } from "./siteUrlServer";
import { buildSitemap, robotsTxt } from "./seo";
import { loadSitemapData } from "./seoServer";

const notFoundText = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });

const HEADERS = (type: string) => ({ "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-cache" });

export async function storefrontSitemap(slug: string): Promise<Response> {
  const r = await resolveStorefrontCompany(slug);
  if (!r) return notFoundText();
  const data = await loadSitemapData(r.companyId);
  const xml = buildSitemap(r.company, data, (lang, page) => siteUrl(r.company, { lang, page }));
  return new Response(xml, { headers: HEADERS("application/xml") });
}

export async function storefrontRobots(slug: string): Promise<Response> {
  const r = await resolveStorefrontCompany(slug);
  if (!r) return notFoundText();
  const root = siteUrl(r.company, { lang: r.company.settings.defaultLanguage });
  const body = robotsTxt(root.replace(/\/[a-z]{2}$/, "/"), siteUrl(r.company, { file: "sitemap.xml" }));
  return new Response(body, { headers: HEADERS("text/plain") });
}
