// src/lib/storefront/page.ts
// Κοινό «άνοιγμα» για όλες τις σελίδες /s/... — ΜΟΝΟ server.
// Εταιρία (μέσω resolveStorefrontCompany) + γλώσσα, αλλιώς 404.

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { resolveStorefrontCompany, type ResolvedStorefront } from "./resolve";
import { storefrontPath } from "./slug";

// Μία ανάγνωση της βάσης ανά αίτημα, ακόμη κι αν τη ζητήσουν και τα
// metadata και η σελίδα.
const resolveOnce = cache(resolveStorefrontCompany);

export interface StorefrontPage extends ResolvedStorefront {
  lang: string;
}

/**
 * `langParam` = το τμήμα γλώσσας του URL (/s/<slug>/<lang>/…).
 * Άγνωστη εταιρία ή γλώσσα που δεν υποστηρίζει η εταιρία → 404.
 */
export async function openStorefront(slug: string, langParam: string | undefined): Promise<StorefrontPage> {
  const resolved = await resolveOnce(slug);
  if (!resolved || !langParam) notFound();
  if (!resolved.company.settings.supportedLanguages.includes(langParam)) notFound();
  return { ...resolved, lang: langParam };
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
