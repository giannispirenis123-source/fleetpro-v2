// src/lib/storefront/routes.tsx
// Οι σελίδες του site (/s/<slug>/<lang>, …/search, …/book, …/v/<id>) — τα
// αρχεία page.tsx απλώς τις καλούν με τις παραμέτρους τους. ΜΟΝΟ server.
//
// Σειρά σε κάθε σελίδα: openStorefront (εταιρία ΜΟΝΟ από το slug, μέσω
// resolveStorefrontCompany· χωρίς publicSite → 404) → κατάλογος της ΙΔΙΑΣ
// εταιρίας → έλεγχοι κριτηρίων ξανά στον server → quote()/διαθεσιμότητα.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { openStorefront } from "./page";
import { loadPublicVehicle } from "./resolve";
import { pickText } from "./settings";
import { storefrontPath } from "./slug";
import { storefrontDictionary } from "./i18n";
import {
  StorefrontBook,
  StorefrontHome,
  StorefrontSearch,
  StorefrontVehicle,
  type SearchBoxData,
} from "@/components/storefront/StorefrontViews";
import { homeCards, loadSiteCatalog, quoteCard, searchCards, type SiteCatalog } from "../public/site";
import { isCardKey, isSortOrder, type SortOrder } from "../public/catalog";
import {
  criteriaToQuery,
  defaultCriteria,
  hasSearch,
  nowLocal,
  parseCriteria,
  validateCriteria,
  type SearchCriteria,
} from "../public/search";
import { textFor } from "../public/text";
import { cloudinaryThumb } from "../vehiclePhotos";
import type { PublicCompany } from "./publicData";

export interface StorefrontParams {
  slug: string;
  lang?: string;
  vehicleId?: string;
}

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const sortOf = (sp: SearchParams): SortOrder => {
  const s = first(sp.sort);
  return isSortOrder(s) ? s : "price_asc";
};

/* ─────────────────────────────────────────────
   Κοινά
   ───────────────────────────────────────────── */

function heroOg(company: PublicCompany): Metadata["openGraph"] {
  const hero = company.settings.theme.heroImage?.url;
  return hero ? { images: [{ url: cloudinaryThumb(hero, 1200), width: 1200 }] } : undefined;
}

function homeTitle(company: PublicCompany, lang: string) {
  const s = company.settings;
  const t = textFor(s.theme.heroTitle, lang) || pickText(s.title, lang, s.defaultLanguage);
  return t && t !== company.name ? `${t} — ${company.name}` : company.name;
}

function searchBoxData(company: PublicCompany, cat: SiteCatalog, lang: string, initial: SearchCriteria): SearchBoxData {
  return {
    action: storefrontPath(company.slug, lang, "search"),
    initial,
    rules: cat.rules,
    locations: cat.locations.map((l) => ({
      slug: l.slug,
      name: textFor(l.name, lang) || l.slug,
      allowPickup: l.allowPickup,
      allowDropoff: l.allowDropoff,
    })),
    ages: cat.ageBands.map((b) => ({
      value: b.minAge,
      label: b.maxAge >= 99 ? `${b.minAge}+` : `${b.minAge}–${b.maxAge}`,
      hint: [textFor(b.label, lang), textFor(b.explanation, lang)].filter(Boolean).join(" — "),
    })),
    today: nowLocal(cat.rules.timezone).slice(0, 10),
  };
}

async function catalogOr404(companyId: string) {
  const cat = await loadSiteCatalog(companyId);
  if (!cat) notFound();
  return cat;
}

/* ─────────────────────────────────────────────
   Αρχική
   ───────────────────────────────────────────── */

export async function storefrontHomeMetadata(p: StorefrontParams): Promise<Metadata> {
  const { company, lang } = await openStorefront(p.slug, p.lang);
  const s = company.settings;
  const description = textFor(s.theme.heroSubtitle, lang) || pickText(s.tagline, lang, s.defaultLanguage) || undefined;
  const title = homeTitle(company, lang);
  return {
    title,
    description,
    openGraph: { title, description, locale: lang, type: "website", ...heroOg(company) },
    alternates: {
      languages: Object.fromEntries(s.supportedLanguages.map((l) => [l, storefrontPath(company.slug, l)])),
    },
    robots: { index: true, follow: true },
  };
}

export async function StorefrontHomePage({ params, searchParams = {} }: { params: StorefrontParams; searchParams?: SearchParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang);
  const cat = await catalogOr404(companyId);
  const initial = defaultCriteria(cat.rules);
  return (
    <StorefrontHome
      company={company}
      lang={lang}
      cards={homeCards(cat, lang)}
      search={searchBoxData(company, cat, lang, initial)}
      initialType={parseCriteria(searchParams).type}
      initialSort={sortOf(searchParams)}
    />
  );
}

/* ─────────────────────────────────────────────
   Αναζήτηση — noindex
   ───────────────────────────────────────────── */

export async function storefrontSearchMetadata(p: StorefrontParams): Promise<Metadata> {
  const { company, lang } = await openStorefront(p.slug, p.lang);
  const d = storefrontDictionary(lang);
  return {
    title: `${d.resultsTitle} — ${company.name}`,
    robots: { index: false, follow: false },
    openGraph: { title: company.name, locale: lang, ...heroOg(company) },
  };
}

export async function StorefrontSearchPage({ params, searchParams }: { params: StorefrontParams; searchParams: SearchParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang);
  if (!hasSearch(searchParams)) redirect(storefrontPath(company.slug, lang));
  const cat = await catalogOr404(companyId);
  const d = storefrontDictionary(lang);

  const criteria = parseCriteria(searchParams);
  // Οι ΙΔΙΟΙ έλεγχοι με τη φόρμα — ξανά, εδώ, πάντα.
  const problems = validateCriteria(criteria, cat.rules);
  const query = criteriaToQuery(criteria);
  const cards =
    problems.length > 0
      ? []
      : await searchCards(
          cat,
          criteria,
          lang,
          (card) => storefrontPath(company.slug, lang, "book", criteriaToQuery({ ...criteria, type: null }, { g: card.key })),
          d.unavailable
        );

  return (
    <StorefrontSearch
      company={company}
      lang={lang}
      query={query}
      cards={cards}
      problems={problems}
      search={searchBoxData(company, cat, lang, criteria.from && criteria.to ? criteria : defaultCriteria(cat.rules))}
      initialSort={sortOf(searchParams)}
    />
  );
}

/* ─────────────────────────────────────────────
   Περίληψη κράτησης (μέχρι το PR 3) — noindex
   ───────────────────────────────────────────── */

export async function storefrontBookMetadata(p: StorefrontParams): Promise<Metadata> {
  const { company, lang } = await openStorefront(p.slug, p.lang);
  const d = storefrontDictionary(lang);
  return {
    title: `${company.rentalMode === "REQUEST" ? d.requestTitle : d.bookTitle} — ${company.name}`,
    robots: { index: false, follow: false },
  };
}

export async function StorefrontBookPage({ params, searchParams }: { params: StorefrontParams; searchParams: SearchParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang);
  const key = first(searchParams.g);
  if (!hasSearch(searchParams) || !isCardKey(key)) redirect(storefrontPath(company.slug, lang));
  const cat = await catalogOr404(companyId);
  const d = storefrontDictionary(lang);

  const criteria = { ...parseCriteria(searchParams), type: null };
  const query = criteriaToQuery(criteria);
  const backHref = storefrontPath(company.slug, lang, "search", query);
  const problems = validateCriteria(criteria, cat.rules);

  // Ξανά διαθεσιμότητα + τιμή για ΑΥΤΗ την κάρτα (το link μπορεί να είναι παλιό).
  const cards = problems.length > 0 ? [] : await searchCards(cat, criteria, lang, () => "#", d.unavailable);
  const card = cards.find((c) => c.key === key) ?? null;
  const q = card && card.bookHref ? quoteCard(cat, key, criteria) : null;
  const locName = (slug: string | null) => {
    const l = slug ? cat.locations.find((x) => x.slug === slug) : null;
    return l ? textFor(l.name, lang) || l.slug : null;
  };

  return (
    <StorefrontBook
      company={company}
      lang={lang}
      query={criteriaToQuery(criteria, { g: key })}
      card={card}
      quote={q && q.ok ? q : null}
      criteria={criteria}
      pickupName={locName(criteria.pl)}
      dropoffName={locName(criteria.dl)}
      backHref={backHref}
    />
  );
}

/* ─────────────────────────────────────────────
   Σελίδα οχήματος (όπως πριν)
   ───────────────────────────────────────────── */

export async function storefrontVehicleMetadata(p: StorefrontParams): Promise<Metadata> {
  const { company, companyId } = await openStorefront(p.slug, p.lang);
  const vehicle = p.vehicleId ? await loadPublicVehicle(companyId, p.vehicleId) : null;
  return { title: vehicle ? `${vehicle.brand} ${vehicle.model} — ${company.name}` : company.name };
}

export async function StorefrontVehiclePage({ params }: { params: StorefrontParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang);
  const vehicle = params.vehicleId ? await loadPublicVehicle(companyId, params.vehicleId) : null;
  if (!vehicle) notFound();
  return <StorefrontVehicle company={company} vehicle={vehicle} lang={lang} />;
}

