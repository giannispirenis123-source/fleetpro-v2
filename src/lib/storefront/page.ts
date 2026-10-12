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
 * `langParam` = το τμήμα γλώσσας του URL (undefined στο /s/<slug>).
 * · Γλώσσα που δεν υποστηρίζει η εταιρία → 404.
 * · Η προεπιλεγμένη γλώσσα με πρόθεμα (/s/x/el όταν default = el) →
 *   redirect στο κανονικό URL χωρίς πρόθεμα.
 */
export async function openStorefront(
  slug: string,
  langParam: string | undefined,
  vehicleId?: string
): Promise<StorefrontPage> {
  const resolved = await resolveOnce(slug);
  if (!resolved) notFound();

  const { supportedLanguages, defaultLanguage } = resolved.company.settings;
  const lang = langParam ?? defaultLanguage;
  if (!supportedLanguages.includes(lang)) notFound();
  if (langParam !== undefined && langParam === defaultLanguage) {
    redirect(storefrontPath(resolved.company.slug, lang, defaultLanguage, vehicleId));
  }

  return { ...resolved, lang };
}

