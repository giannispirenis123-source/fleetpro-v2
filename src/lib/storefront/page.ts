// src/lib/storefront/page.ts
// Κοινό «άνοιγμα» για όλες τις σελίδες /s/... — ΜΟΝΟ server.
// Εταιρία (μέσω resolveStorefrontCompany) + γλώσσα.
//
// 404 ΜΟΝΟ όταν η εταιρία δεν είναι δημόσια (άγνωστο slug, ανενεργή σελίδα,
// χωρίς publicSite — ίδιο 404, χωρίς να φαίνεται ποιο). Γλώσσα που δεν
// υποστηρίζει η εταιρία ΔΕΝ δίνει 404: redirect στην προεπιλεγμένη.

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { resolveStorefrontCompany, type ResolvedStorefront } from "./resolve";
import { chooseLanguage, storefrontPath } from "./slug";

// Μία ανάγνωση της βάσης ανά αίτημα, ακόμη κι αν τη ζητήσουν και τα
// metadata και η σελίδα.
const resolveOnce = cache(resolveStorefrontCompany);

export interface StorefrontPage extends ResolvedStorefront {
  lang: string;
}

export type SitePage = "" | "search" | "book" | { vehicleId: string };

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
  if (!choice.ok) redirect(storefrontPath(resolved.company.slug, choice.redirectTo, page, query));
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
  redirect(storefrontPath(company.slug, company.settings.defaultLanguage, vehicleId ? { vehicleId } : ""));
}
