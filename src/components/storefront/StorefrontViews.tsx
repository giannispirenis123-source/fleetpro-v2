// src/components/storefront/StorefrontViews.tsx
// Οι σελίδες του δημόσιου site — server components. Παίρνουν ΜΟΝΟ
// καθαρισμένα δεδομένα (PublicCompany/PublicVehicle από το publicData.ts,
// κάρτες από το catalog.ts) — ποτέ id εταιρίας ή άλλο εσωτερικό στοιχείο.
// JavaScript στον browser μόνο για το κουτί αναζήτησης και τις καρτέλες.

import Link from "next/link";
import type { PublicCompany, PublicVehicle } from "@/lib/storefront/publicData";
import { pickText } from "@/lib/storefront/settings";
import { storefrontPath } from "@/lib/storefront/slug";
import {
  fill,
  formatDateTime,
  formatEuro,
  storefrontDictionary,
  type StorefrontDictionary,
} from "@/lib/storefront/i18n";
import { cloudinaryThumb } from "@/lib/vehiclePhotos";
import { formatCents } from "@/lib/public/money";
import { textFor } from "@/lib/public/text";
import type { ResultCard, SortOrder } from "@/lib/public/catalog";
import type { QuoteResult, VehicleType } from "@/lib/public/pricing";
import type { SearchCriteria, SearchProblem, SearchRules } from "@/lib/public/search";
import SearchBox, { type SearchAgeOption, type SearchLocationOption } from "./SearchBox";
import Results, { GroupCard } from "./Results";
import "./storefront.css";

interface Ctx {
  company: PublicCompany;
  lang: string;
  d: StorefrontDictionary;
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const waHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/** Τηλέφωνο/email/WhatsApp: της καρτέλας «Κρατήσεις & Επικοινωνία», αλλιώς των Ρυθμίσεων. */
export function contactOf(company: PublicCompany) {
  const c = company.settings.contact;
  return {
    phone: c.phone || company.phone,
    email: c.email || company.email,
    whatsapp: c.whatsapp || null,
    address: c.address || [company.address, company.region].filter(Boolean).join(", ") || null,
  };
}

/* ─────────────────────────────────────────────
   Κέλυφος: header (λογότυπο, γλώσσες), footer (επικοινωνία)
   ───────────────────────────────────────────── */

function Shell({
  ctx,
  langHref,
  children,
}: {
  ctx: Ctx;
  /** Το ίδιο URL σε άλλη γλώσσα — κρατά τα κριτήρια αναζήτησης. */
  langHref: (code: string) => string;
  children: React.ReactNode;
}) {
  const { company, lang, d } = ctx;
  const { supportedLanguages } = company.settings;
  const home = storefrontPath(company.slug, lang);
  const contact = contactOf(company);
  const corner = company.settings.theme.cornerStyle === "rounded" ? "12px" : "999px";

  return (
    <div
      className="sf"
      style={{
        ["--sf-brand" as string]: company.brandColor,
        ["--sf-accent" as string]: company.settings.theme.accentColor ?? company.brandColor,
        ["--sf-btn-radius" as string]: corner,
      }}
    >
      <a href="#sf-main" className="sf-skip">
        {d.skipToContent}
      </a>
      <header className="sf-header">
        <div className="sf-wrap sf-header-row">
          <Link href={home} className="sf-brand" aria-label={`${company.name} — ${d.homeLabel}`}>
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt={company.name} className="sf-logo" />
            ) : (
              <span className="sf-logo-mark" aria-hidden>
                {company.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <span className="sf-brand-name">{company.name}</span>
          </Link>
          <div className="sf-header-actions">
            {supportedLanguages.length > 1 && (
              <nav className="sf-langs" aria-label={d.language}>
                {supportedLanguages.map((code) => (
                  <a
                    key={code}
                    href={langHref(code)}
                    className={code === lang ? "sf-lang is-active" : "sf-lang"}
                    hrefLang={code}
                    lang={code}
                    aria-current={code === lang ? "true" : undefined}
                    title={storefrontDictionary(code).langName}
                  >
                    {code.toUpperCase()}
                  </a>
                ))}
              </nav>
            )}
            {contact.phone && (
              <a href={telHref(contact.phone)} className="sf-btn sf-btn--primary sf-btn--sm sf-header-call">
                {d.call}
              </a>
            )}
          </div>
        </div>
      </header>

      <main id="sf-main">{children}</main>

      <ContactSection ctx={ctx} />

      <footer className="sf-footer">
        <div className="sf-wrap sf-footer-row">
          <span>
            © {new Date().getFullYear()} {company.name}
          </span>
          <span className="sf-muted">{d.poweredBy}</span>
        </div>
      </footer>
    </div>
  );
}

function ContactButtons({ ctx }: { ctx: Ctx }) {
  const { d } = ctx;
  const c = contactOf(ctx.company);
  return (
    <div className="sf-contact-actions">
      {c.phone && (
        <a href={telHref(c.phone)} className="sf-btn sf-btn--primary">
          {d.call}: {c.phone}
        </a>
      )}
      {c.whatsapp && (
        <a href={waHref(c.whatsapp)} className="sf-btn sf-btn--ghost" target="_blank" rel="noopener noreferrer">
          {d.whatsapp}
        </a>
      )}
      {c.email && (
        <a href={`mailto:${c.email}`} className="sf-btn sf-btn--ghost">
          {d.email}: {c.email}
        </a>
      )}
    </div>
  );
}

function ContactSection({ ctx }: { ctx: Ctx }) {
  const { company, d } = ctx;
  const c = contactOf(company);
  return (
    <section id="contact" className="sf-contact" aria-labelledby="sf-contact-title">
      <div className="sf-wrap">
        <h2 className="sf-h2" id="sf-contact-title">
          {d.contactUs}
        </h2>
        <p className="sf-muted">{d.contactText}</p>
        <ContactButtons ctx={ctx} />
        {c.address && <p className="sf-muted sf-place">{c.address}</p>}
        {company.settings.paymentOptions.onPickup && <p className="sf-note">{d.payOnPickup}</p>}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Κοινά στοιχεία της αναζήτησης
   ───────────────────────────────────────────── */

export interface SearchBoxData {
  action: string;
  initial: SearchCriteria;
  rules: SearchRules;
  locations: SearchLocationOption[];
  ages: SearchAgeOption[];
  today: string;
}

function heroTexts(company: PublicCompany, lang: string, d: StorefrontDictionary) {
  const s = company.settings;
  const title =
    textFor(s.theme.heroTitle, lang) || pickText(s.title, lang, s.defaultLanguage) || fill(d.heroTitle, { name: company.name });
  const subtitle = textFor(s.theme.heroSubtitle, lang) || pickText(s.tagline, lang, s.defaultLanguage);
  return { title, subtitle };
}

const HERO_WIDTHS = [640, 960, 1280, 1600, 2000];

/* ─────────────────────────────────────────────
   /s/<slug>/<lang> — αρχική
   ───────────────────────────────────────────── */

export function StorefrontHome({
  company,
  lang,
  cards,
  search,
  initialType,
  initialSort,
}: {
  company: PublicCompany;
  lang: string;
  cards: ResultCard[];
  search: SearchBoxData;
  initialType: VehicleType | null;
  initialSort: SortOrder;
}) {
  const d = storefrontDictionary(lang);
  const ctx: Ctx = { company, lang, d };
  const { settings } = company;
  const { title, subtitle } = heroTexts(company, lang, d);
  const about = pickText(settings.about, lang, settings.defaultLanguage);
  const hero = settings.theme.heroImage?.url ?? null;

  return (
    <Shell ctx={ctx} langHref={(code) => storefrontPath(company.slug, code)}>
      <section className={`sf-hero${hero ? " has-photo" : ""}`}>
        <div className="sf-hero-bg" aria-hidden={!hero}>
          {hero && (
            // LCP: φορτώνει αμέσως, με υψηλή προτεραιότητα και σωστό μέγεθος.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cloudinaryThumb(hero, 1600)}
              srcSet={HERO_WIDTHS.map((w) => `${cloudinaryThumb(hero, w)} ${w}w`).join(", ")}
              sizes="100vw"
              alt={title}
              fetchPriority="high"
              loading="eager"
              decoding="async"
            />
          )}
        </div>
        <div className="sf-wrap sf-hero-inner">
          <div className="sf-hero-head">
            <h1 className="sf-h1">{title}</h1>
            {subtitle && <p className="sf-tagline">{subtitle}</p>}
          </div>
          <SearchBox {...search} lang={lang} d={d} />
        </div>
      </section>

      {about && (
        <section className="sf-wrap sf-about">
          {about.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}

      <div className="sf-wrap sf-section">
        {cards.length === 0 ? (
          <>
            <h2 className="sf-h2">{d.ourVehicles}</h2>
            <p className="sf-muted">{d.noVehicles}</p>
          </>
        ) : (
          <Results
            cards={cards}
            initialType={initialType}
            initialSort={initialSort}
            mode="home"
            rentalMode={company.rentalMode}
            lang={lang}
            d={d}
            title={d.ourVehicles}
          />
        )}
      </div>
    </Shell>
  );
}

/* ─────────────────────────────────────────────
   /s/<slug>/<lang>/search — αποτελέσματα
   ───────────────────────────────────────────── */

export function StorefrontSearch({
  company,
  lang,
  query,
  cards,
  problems,
  search,
  initialSort,
}: {
  company: PublicCompany;
  lang: string;
  /** Το query string της αναζήτησης (για την αλλαγή γλώσσας). */
  query: string;
  cards: ResultCard[];
  problems: SearchProblem[];
  search: SearchBoxData;
  initialSort: SortOrder;
}) {
  const d = storefrontDictionary(lang);
  const ctx: Ctx = { company, lang, d };
  const anyAvailable = cards.some((c) => c.bookHref);

  return (
    <Shell ctx={ctx} langHref={(code) => storefrontPath(company.slug, code, "search", query)}>
      <section className="sf-search-band">
        <div className="sf-wrap">
          <h1 className="sf-h1 sf-h1--dark sf-h1--sm">{d.resultsTitle}</h1>
          <SearchBox {...search} lang={lang} d={d} serverProblems={problems} compact />
        </div>
      </section>

      <div className="sf-wrap sf-section">
        {problems.length > 0 ? null : !anyAvailable ? (
          <div className="sf-empty" role="status">
            <h2 className="sf-h2">{d.noResultsTitle}</h2>
            <p className="sf-muted">{d.noResultsText}</p>
            <ContactButtons ctx={ctx} />
            {cards.length > 0 && (
              <Results
                cards={cards}
                initialType={search.initial.type}
                initialSort={initialSort}
                mode="search"
                rentalMode={company.rentalMode}
                lang={lang}
                d={d}
                title={d.ourVehicles}
              />
            )}
          </div>
        ) : (
          <Results
            cards={cards}
            initialType={search.initial.type}
            initialSort={initialSort}
            mode="search"
            rentalMode={company.rentalMode}
            lang={lang}
            d={d}
            title={d.resultsTitle}
          />
        )}
      </div>
    </Shell>
  );
}

/* ─────────────────────────────────────────────
   /s/<slug>/<lang>/book — περίληψη (μέχρι το PR 3)
   ───────────────────────────────────────────── */

export function StorefrontBook({
  company,
  lang,
  query,
  card,
  quote,
  criteria,
  pickupName,
  dropoffName,
  backHref,
}: {
  company: PublicCompany;
  lang: string;
  query: string;
  card: ResultCard | null;
  quote: QuoteResult | null;
  criteria: SearchCriteria;
  pickupName: string | null;
  dropoffName: string | null;
  backHref: string;
}) {
  const d = storefrontDictionary(lang);
  const ctx: Ctx = { company, lang, d };
  const request = company.rentalMode === "REQUEST";
  const ok = !!card && !!quote && !!card.bookHref;

  return (
    <Shell ctx={ctx} langHref={(code) => storefrontPath(company.slug, code, "book", query)}>
      <div className="sf-wrap sf-section sf-book">
        <a href={backHref} className="sf-back">
          ← {d.backToResults}
        </a>
        <h1 className="sf-h1 sf-h1--dark">{request ? d.requestTitle : d.bookTitle}</h1>

        {!ok || !card || !quote ? (
          <div className="sf-empty" role="status">
            <p>{d.notBookable}</p>
            <ContactButtons ctx={ctx} />
          </div>
        ) : (
          <div className="sf-book-grid">
            <div>
              <GroupCard card={{ ...card, bookHref: null }} mode="search" rentalMode={company.rentalMode} lang={lang} d={d} eager />
            </div>
            <div className="sf-book-panel">
              <dl className="sf-dl sf-dl--left">
                <dt>{d.pickupAt}</dt>
                <dd>
                  {formatDateTime(criteria.from, d)}
                  {pickupName && <span className="sf-muted"> · {pickupName}</span>}
                </dd>
                <dt>{d.dropoffAt}</dt>
                <dd>
                  {formatDateTime(criteria.to, d)}
                  <span className="sf-muted"> · {dropoffName ?? (pickupName ? d.sameLocation : "")}</span>
                </dd>
              </dl>

              <h2 className="sf-h3">{d.priceBreakdown}</h2>
              <table className="sf-lines">
                <tbody>
                  {quote.lines.map((l, i) => (
                    <tr key={i} className={l.totalCents < 0 ? "is-discount" : undefined}>
                      <th scope="row">
                        {textFor(l.label, lang)}
                        {l.qty > 1 && <span className="sf-muted"> × {l.qty}</span>}
                      </th>
                      <td>{formatCents(l.totalCents, lang)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{d.total}</th>
                    <td>
                      {quote.listTotalCents > quote.totalCents && <s className="sf-was">{formatCents(quote.listTotalCents, lang)}</s>}{" "}
                      <strong>{formatCents(quote.totalCents, lang)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="sf-muted sf-small">{fill(d.vatIncludedAmount, { amount: formatCents(quote.vatCents, lang) })}</p>
              {!!(quote.depositCents || quote.excessCents) && (
                <p className="sf-muted sf-small">
                  {quote.depositCents ? `${d.deposit}: ${formatCents(quote.depositCents, lang)}` : ""}
                  {quote.depositCents && quote.excessCents ? " · " : ""}
                  {quote.excessCents ? `${d.excess}: ${formatCents(quote.excessCents, lang)}` : ""}
                </p>
              )}

              <p className="sf-book-next">{request ? d.requestSoon : d.bookingSoon}</p>
              <ContactButtons ctx={ctx} />
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

/* ─────────────────────────────────────────────
   /s/<slug>/<lang>/v/<vehicleId> — βασική σελίδα οχήματος
   ───────────────────────────────────────────── */

function Specs({ v, d }: { v: PublicVehicle; d: StorefrontDictionary }) {
  return (
    <ul className="sf-specs">
      <li>{d.categories[v.category] ?? v.category}</li>
      <li>{d.fuels[v.fuel] ?? v.fuel}</li>
      <li>{fill(d.seats, { n: v.seats })}</li>
      <li>{d.transmissions[v.transmission] ?? v.transmission}</li>
    </ul>
  );
}

export function StorefrontVehicle({
  company,
  vehicle: v,
  lang,
}: {
  company: PublicCompany;
  vehicle: PublicVehicle;
  lang: string;
}) {
  const d = storefrontDictionary(lang);
  const ctx: Ctx = { company, lang, d };
  const back = storefrontPath(company.slug, lang);

  return (
    <Shell ctx={ctx} langHref={(code) => storefrontPath(company.slug, code, { vehicleId: v.id })}>
      <div className="sf-wrap sf-vehicle">
        <Link href={back} className="sf-back">
          ← {d.back}
        </Link>
        <div className="sf-vehicle-grid">
          <div>
            {v.photos.length === 0 ? (
              <div className="sf-gallery-main sf-noimg">{d.noPhoto}</div>
            ) : (
              // Gallery με scroll-snap: σύρσιμο στο κινητό, χωρίς JavaScript.
              <>
                <div className="sf-gallery" aria-label={d.photos}>
                  {v.photos.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={url}
                      id={`photo-${i + 1}`}
                      src={cloudinaryThumb(url, 1200)}
                      alt={`${v.brand} ${v.model} — ${i + 1}/${v.photos.length}`}
                      loading={i === 0 ? "eager" : "lazy"}
                    />
                  ))}
                </div>
                {v.photos.length > 1 && (
                  <div className="sf-thumbs">
                    {v.photos.map((url, i) => (
                      <a key={url} href={`#photo-${i + 1}`} aria-label={`${i + 1}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cloudinaryThumb(url, 160)} alt="" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="sf-vehicle-info">
            <h1 className="sf-h1 sf-h1--dark">
              {v.brand} {v.model}
            </h1>
            <Specs v={v} d={d} />
            <p className="sf-price">
              {fill(d.fromPerDay, { price: formatEuro(v.dailyRate, lang) })} <span className="sf-muted">{d.vatIncluded}</span>
            </p>
            <dl className="sf-dl">
              <dt>{d.category}</dt>
              <dd>{d.categories[v.category] ?? v.category}</dd>
              <dt>{d.fuel}</dt>
              <dd>{d.fuels[v.fuel] ?? v.fuel}</dd>
              <dt>{d.transmission}</dt>
              <dd>{d.transmissions[v.transmission] ?? v.transmission}</dd>
              <dt>{d.seatsLabel}</dt>
              <dd>{v.seats}</dd>
              <dt>{d.doorsLabel}</dt>
              <dd>{v.doors}</dd>
              <dt>{d.year}</dt>
              <dd>{v.year}</dd>
              {v.ac && (
                <>
                  <dt>{d.ac}</dt>
                  <dd>✓</dd>
                </>
              )}
            </dl>
            <a href={`${back}#sf-search`} className="sf-btn sf-btn--primary sf-btn--block">
              {d.seePrices}
            </a>
          </div>
        </div>
      </div>
    </Shell>
  );
}
