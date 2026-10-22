// src/lib/storefront/page.ts
// Κοινό «άνοιγμα» για όλες τις σελίδες /s/... (και του domain εταιρίας) — ΜΟΝΟ server.
// Εταιρία (μέσω resolveStorefrontCompany) + γλώσσα.
//
// 404 ΜΟΝΟ όταν η εταιρία δεν είναι δημόσια (άγνωστο slug, ανενεργή σελίδα,
// χωρίς publicSite — ίδιο 404, χωρίς να φαίνεται ποιο). Γλώσσα που δεν
// υποστηρίζει η εταιρία ΔΕΝ δίνει 404: redirect στην προεπιλεγμένη.

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { resolveStorefrontParam, type ResolvedStorefront } from "./resolve";
import { chooseLanguage, sitePath, type SitePath } from "./slug";

// Μία ανάγνωση της βάσης ανά αίτημα, ακόμη κι αν τη ζητήσουν και τα
// metadata και η σελίδα.
// [slug] = slug ή DOMAIN_SLUG (domain εταιρίας, βλ. resolveStorefrontParam).
const resolveOnce = cache(resolveStorefrontParam);

export interface StorefrontPage extends ResolvedStorefront {
  lang: string;
}

export type SitePage = SitePath;

/**
 * `langParam` = το τμήμα γλώσσας του URL (/s/<slug>/<lang>/…), `page` = πού
 * βρισκόμαστε (για το redirect γλώσσας), `query` = τα κριτήρια (κρατιούνται).
 */
export async function openStorefront(
  slug: string,
  langParam: string | undefined,
  page: SitePage = "",
  query = ""
): Promise<StorefrontPage> {
  const resolved = await resolveOnce(slug);
  if (!resolved) notFound();
  const { supportedLanguages, defaultLanguage } = resolved.company.settings;
  const choice = chooseLanguage(langParam, supportedLanguages, defaultLanguage);
  if (!choice.ok) redirect(sitePath(resolved.company, choice.redirectTo, page, query));
  return { ...resolved, lang: choice.lang };
}

/**
 * Τα παλιά URL χωρίς γλώσσα (/s/<slug>, /s/<slug>/v/<id>) → η ίδια σελίδα
 * στην προεπιλεγμένη γλώσσα της εταιρίας. Τα links που έχουν ήδη μοιραστεί
 * συνεχίζουν να δουλεύουν.
 */
export async function redirectToDefaultLanguage(slug: string, vehicleId?: string): Promise<never> {
  const resolved = await resolveOnce(slug);
  if (!resolved) notFound();
  const { company } = resolved;
  redirect(sitePath(company, company.settings.defaultLanguage, vehicleId ? { vehicleId } : ""));
}
