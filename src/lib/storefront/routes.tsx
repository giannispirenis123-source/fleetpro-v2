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
import { storefrontPath } from "./slug";
import { storefrontDictionary } from "./i18n";
import { headers } from "next/headers";
import { siteUrl } from "./siteUrlServer";
import { businessJsonLd, homeSeoDescription, homeSeoTitle, indexablePage, noindexPage } from "./seo";
import { loadSeoLocations } from "./seoServer";
import { loadLegalDoc } from "../legal/legalServer";
import { isLegalKind, type LegalKind } from "../legal/legal";
import { parseMarkdown, plainText } from "../legal/markdown";
import { publicFormQuote, needsFlight } from "../public/bookingSubmit";
import { extraOptions, insuranceOptions, toPublicQuote } from "../public/bookingView";
import { loadConfirmation } from "../public/bookingLookup";
import { loadReviewSection, loadSitePlace, loadSitePlaces } from "../public/placesServer";
import { loadSitePayment } from "../public/paymentServer";
import { availableMethods } from "../public/payments";
import { hitLimit, LIMITS } from "../public/rateLimit";
import { dbCounterStore } from "../public/rateLimitStore";
import {
  StorefrontConfirmation,
  StorefrontBook,
  StorefrontHome,
  StorefrontLegal,
  StorefrontPlace,
  contactOf,
  StorefrontSearch,
  StorefrontVehicle,
  type SearchBoxData,
} from "@/components/storefront/StorefrontViews";
import { homeCards, loadSiteCatalog, searchCards, type SiteCatalog } from "../public/site";
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

/** Τα query params όπως ήρθαν (για να κρατηθούν σε redirect γλώσσας). */
function rawQuery(sp: SearchParams = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, x);
  }
  return q.toString();
}
const sortOf = (sp: SearchParams): SortOrder => {
  const s = first(sp.sort);
  return isSortOrder(s) ? s : "price_asc";
};

/* ─────────────────────────────────────────────
   Κοινά
   ───────────────────────────────────────────── */

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

export async function storefrontHomeMetadata(p: StorefrontParams, sp: SearchParams = {}): Promise<Metadata> {
  const { company, lang } = await openStorefront(p.slug, p.lang, "", rawQuery(sp));
  return indexablePage({
    company,
    lang,
    title: homeSeoTitle(company, lang),
    description: homeSeoDescription(company, lang),
    url: (l) => siteUrl(company, { lang: l }),
  });
}

export async function StorefrontHomePage({ params, searchParams = {} }: { params: StorefrontParams; searchParams?: SearchParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang, "", rawQuery(searchParams));
  const cat = await catalogOr404(companyId);
  const initial = defaultCriteria(cat.rules);
  // Μέρη: με τοποθεσία παραλαβής στο URL (pl), πρώτα τα δικά της.
  const pl = first(searchParams.pl);
  const url = siteUrl(company, { lang });
  const [places, reviews, locations] = await Promise.all([
    loadSitePlaces(companyId, pl && /^[a-z0-9-]{1,60}$/.test(pl) ? pl : null, lang),
    loadReviewSection(companyId, lang, { name: company.name, url }),
    loadSeoLocations(companyId, lang),
  ]);
  const jsonLd = businessJsonLd({ company, url, contact: contactOf(company), locations, reviewsJsonLd: reviews.jsonLd });
  return (
    <StorefrontHome
      company={company}
      lang={lang}
      cards={homeCards(cat, lang)}
      search={searchBoxData(company, cat, lang, initial)}
      initialType={parseCriteria(searchParams).type}
      initialSort={sortOf(searchParams)}
      places={places}
      reviews={reviews.section}
      jsonLd={jsonLd}
    />
  );
}

/* ─────────────────────────────────────────────
   Μέρος για επίσκεψη — /places/<placeSlug> (index)
   ───────────────────────────────────────────── */

export async function storefrontPlaceMetadata(p: StorefrontParams & { placeSlug?: string }): Promise<Metadata> {
  const { company, companyId, lang } = await openStorefront(p.slug, p.lang, { placeSlug: p.placeSlug ?? "" });
  const place = p.placeSlug ? await loadSitePlace(companyId, p.placeSlug, lang) : null;
  // Ανενεργό/άγνωστο μέρος → η σελίδα δίνει 404· εδώ κανένα στοιχείο.
  if (!place) return noindexPage(company.name);
  return indexablePage({
    company,
    lang,
    title: `${place.name} — ${company.name}`,
    description: place.short || place.description,
    url: (l) => siteUrl(company, { lang: l, page: { placeSlug: place.slug } }),
    image: place.coverUrl ? { url: cloudinaryThumb(place.coverUrl, 1200), width: 1200 } : undefined,
    type: "article",
  });
}

export async function StorefrontPlacePage({ params }: { params: StorefrontParams & { placeSlug: string } }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang, { placeSlug: params.placeSlug });
  // Ανενεργό ή μέρος ΑΛΛΗΣ εταιρίας (η αναζήτηση γίνεται μόνο στο companyId) → 404.
  const place = await loadSitePlace(companyId, params.placeSlug, lang);
  if (!place) notFound();
  return <StorefrontPlace company={company} lang={lang} place={place} />;
}

/* ─────────────────────────────────────────────
   Αναζήτηση — noindex
   ───────────────────────────────────────────── */

export async function storefrontSearchMetadata(p: StorefrontParams, sp: SearchParams = {}): Promise<Metadata> {
  const { company, lang } = await openStorefront(p.slug, p.lang, "search", rawQuery(sp));
  return noindexPage(`${storefrontDictionary(lang).resultsTitle} — ${company.name}`);
}

export async function StorefrontSearchPage({ params, searchParams }: { params: StorefrontParams; searchParams: SearchParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang, "search", rawQuery(searchParams));
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

export async function storefrontBookMetadata(p: StorefrontParams, sp: SearchParams = {}): Promise<Metadata> {
  const { company, lang } = await openStorefront(p.slug, p.lang, "book", rawQuery(sp));
  const d = storefrontDictionary(lang);
  return noindexPage(`${company.rentalMode === "REQUEST" ? d.requestTitle : d.bookTitle} — ${company.name}`);
}

export async function StorefrontBookPage({ params, searchParams }: { params: StorefrontParams; searchParams: SearchParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang, "book", rawQuery(searchParams));
  const key = first(searchParams.g);
  if (!hasSearch(searchParams) || !isCardKey(key)) redirect(storefrontPath(company.slug, lang));
  const cat = await catalogOr404(companyId);
  const d = storefrontDictionary(lang);

  const criteria = { ...parseCriteria(searchParams), type: null };
  const query = criteriaToQuery(criteria, { g: key });
  const backHref = storefrontPath(company.slug, lang, "search", criteriaToQuery(criteria));
  const problems = validateCriteria(criteria, cat.rules);

  // Ξανά διαθεσιμότητα + τιμή για ΑΥΤΗ την κάρτα (το link μπορεί να είναι παλιό).
  const cards = problems.length > 0 ? [] : await searchCards(cat, criteria, lang, () => "#", d.unavailable);
  const card = cards.find((c) => c.key === key) ?? null;
  const bookable = !!card?.bookHref;
  // Αρχική τιμή ΧΩΡΙΣ ασφάλεια (καμία προεπιλογή) — ίδια με την κάρτα.
  const fq = bookable ? publicFormQuote(cat, key, criteria, [], null) : null;
  const q = fq && fq.ok ? fq.quote : null;
  const locName = (slug: string | null) => {
    const l = slug ? cat.locations.find((x) => x.slug === slug) : null;
    return l ? textFor(l.name, lang) || l.slug : null;
  };
  const pay = bookable ? await loadSitePayment(companyId) : null;
  const band = criteria.age !== null ? cat.ageBands.find((b) => criteria.age! >= b.minAge && criteria.age! <= b.maxAge) : cat.ageBands.find((b) => b.isDefault);
  const problem = problems.length > 0 ? (lang === "el" ? problems[0].message.el : problems[0].message.en) : null;

  return (
    <StorefrontBook
      company={company}
      lang={lang}
      query={query}
      card={card}
      criteria={criteria}
      pickupName={locName(criteria.pl)}
      dropoffName={locName(criteria.dl)}
      ageLabel={band ? (band.maxAge >= 99 ? `${band.minAge}+` : `${band.minAge}–${band.maxAge}`) : null}
      backHref={backHref}
      problem={problem}
      form={
        card && q && q.ok
          ? {
              slug: company.slug,
              cardKey: key,
              criteria: { pl: criteria.pl, dl: criteria.dl, from: criteria.from, to: criteria.to, age: criteria.age },
              bookPath: storefrontPath(company.slug, lang, "book"),
              query,
              options: extraOptions(cat.ctx, card.type, lang),
              insurance: insuranceOptions(cat.ctx, card.type, lang, q.days),
              initialQuote: toPublicQuote(q),
              needsFlight: needsFlight(cat, criteria.pl, criteria.dl),
              payment: {
                methods: availableMethods(pay?.options ?? "PICKUP_ONLY"),
                amountType: pay?.settings.onlineAmountType ?? "FULL",
                depositPercent: pay?.settings.depositPercent ?? 100,
              },
            }
          : null
      }
    />
  );
}

/* ─────────────────────────────────────────────
   Επιβεβαίωση (/booking/<code>) — noindex, no-store
   ───────────────────────────────────────────── */

export async function storefrontConfirmationMetadata(p: StorefrontParams & { code?: string }): Promise<Metadata> {
  const { company } = await openStorefront(p.slug, p.lang);
  return noindexPage(company.name);
}

export async function StorefrontConfirmationPage({
  params,
  searchParams = {},
}: {
  params: StorefrontParams & { code: string };
  searchParams?: SearchParams;
}) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang);
  // Όριο αιτημάτων ανά client (hash του IP, όχι IP) — κατά της μαντεψιάς κωδικών.
  const ip = (headers().get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await hitLimit(dbCounterStore, LIMITS.confirmationPerClient, ip))) notFound();
  const justPaid = first(searchParams.paid) === "1";
  const b = await loadConfirmation(companyId, params.code, lang, justPaid);
  if (!b) notFound();
  return <StorefrontConfirmation company={company} lang={lang} b={b} justPaid={justPaid} />;
}

/* ─────────────────────────────────────────────
   Σελίδα οχήματος (όπως πριν)
   ───────────────────────────────────────────── */

export async function storefrontVehicleMetadata(p: StorefrontParams): Promise<Metadata> {
  const { company, companyId } = await openStorefront(p.slug, p.lang, { vehicleId: p.vehicleId ?? "" });
  const vehicle = p.vehicleId ? await loadPublicVehicle(companyId, p.vehicleId) : null;
  // Παλιά σελίδα (δεν συνδέεται από πουθενά, οι κάρτες είναι ανά ομάδα): εκτός ευρετηρίου και sitemap.
  return noindexPage(vehicle ? `${vehicle.brand} ${vehicle.model} — ${company.name}` : company.name);
}

export async function StorefrontVehiclePage({ params }: { params: StorefrontParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang, { vehicleId: params.vehicleId ?? "" });
  const vehicle = params.vehicleId ? await loadPublicVehicle(companyId, params.vehicleId) : null;
  if (!vehicle) notFound();
  return <StorefrontVehicle company={company} vehicle={vehicle} lang={lang} />;
}


/* ─────────────────────────────────────────────
   Νομικά — /terms, /privacy, /cookies
   ───────────────────────────────────────────── */

const LEGAL_TITLE = { terms: "legalTerms", privacy: "legalPrivacy", cookies: "legalCookies" } as const;

async function openLegal(p: StorefrontParams, kind: LegalKind) {
  const { company, companyId, lang } = await openStorefront(p.slug, p.lang, kind);
  // Κείμενο ΜΟΝΟ της εταιρίας του slug (companyId από το resolveStorefrontCompany).
  const doc = isLegalKind(kind) ? await loadLegalDoc(companyId, kind, lang) : null;
  if (!doc) notFound();
  return { company, lang, doc };
}

export async function storefrontLegalMetadata(p: StorefrontParams, kind: LegalKind): Promise<Metadata> {
  const { company, lang, doc } = await openLegal(p, kind);
  const blocks = parseMarkdown(doc.body);
  const body = blocks[0]?.t === "h" ? blocks.slice(1) : blocks;
  return indexablePage({
    company,
    lang,
    title: `${storefrontDictionary(lang)[LEGAL_TITLE[kind]]} — ${company.name}`,
    description: plainText(body),
    url: (l) => siteUrl(company, { lang: l, page: kind }),
    type: "article",
  });
}

export async function StorefrontLegalPage({ params, kind }: { params: StorefrontParams; kind: LegalKind }) {
  const { company, lang, doc } = await openLegal(params, kind);
  return <StorefrontLegal company={company} lang={lang} doc={doc} />;
}
