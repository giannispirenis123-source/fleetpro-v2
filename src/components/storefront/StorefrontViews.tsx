// src/components/storefront/StorefrontViews.tsx
// Η δημόσια σελίδα της εταιρίας — server components, ΧΩΡΙΣ JavaScript στον
// browser. Παίρνουν ΜΟΝΟ τα καθαρισμένα PublicCompany/PublicVehicle
// (publicData.ts) — ποτέ id εταιρίας ή άλλο εσωτερικό στοιχείο.

import Link from "next/link";
import type { PublicCompany, PublicVehicle } from "@/lib/storefront/publicData";
import { pickText } from "@/lib/storefront/settings";
import { storefrontPath } from "@/lib/storefront/slug";
import {
  fill,
  formatEuro,
  storefrontDictionary,
  type StorefrontDictionary,
} from "@/lib/storefront/i18n";
import { cloudinaryThumb } from "@/lib/vehiclePhotos";
import "./storefront.css";

interface Ctx {
  company: PublicCompany;
  lang: string;
  d: StorefrontDictionary;
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function Shell({
  ctx,
  vehicleId,
  children,
}: {
  ctx: Ctx;
  vehicleId?: string;
  children: React.ReactNode;
}) {
  const { company, lang, d } = ctx;
  const { supportedLanguages, defaultLanguage } = company.settings;
  const home = storefrontPath(company.slug, lang, defaultLanguage);

  return (
    <div
      className="sf"
      lang={lang}
      style={{ ["--sf-brand" as string]: company.brandColor }}
    >
      <header className="sf-header">
        <div className="sf-wrap sf-header-row">
          <Link href={home} className="sf-brand">
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
                  <Link
                    key={code}
                    href={storefrontPath(company.slug, code, defaultLanguage, vehicleId)}
                    className={code === lang ? "sf-lang is-active" : "sf-lang"}
                    hrefLang={code}
                    aria-current={code === lang ? "true" : undefined}
                    title={storefrontDictionary(code).langName}
                  >
                    {code.toUpperCase()}
                  </Link>
                ))}
              </nav>
            )}
            <a href="#contact" className="sf-btn sf-btn--primary sf-btn--sm">
              {d.contact}
            </a>
          </div>
        </div>
      </header>

      <main>{children}</main>

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

function ContactSection({ ctx }: { ctx: Ctx }) {
  const { company, d } = ctx;
  const place = [company.address, company.region].filter(Boolean).join(", ");
  return (
    <section id="contact" className="sf-contact">
      <div className="sf-wrap">
        <h2 className="sf-h2">{d.contactUs}</h2>
        <p className="sf-muted">{d.contactText}</p>
        <div className="sf-contact-actions">
          {company.phone && (
            <a href={telHref(company.phone)} className="sf-btn sf-btn--primary">
              {d.call}: {company.phone}
            </a>
          )}
          {company.email && (
            <a href={`mailto:${company.email}`} className="sf-btn sf-btn--ghost">
              {d.email}: {company.email}
            </a>
          )}
        </div>
        {place && <p className="sf-muted sf-place">{place}</p>}
        <p className="sf-note">
          {company.settings.paymentOptions.onPickup && <span>{d.payOnPickup} · </span>}
          {d.bookingRequest}
        </p>
      </div>
    </section>
  );
}

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

function Price({ v, ctx }: { v: PublicVehicle; ctx: Ctx }) {
  return (
    <p className="sf-price">
      {fill(ctx.d.fromPerDay, { price: formatEuro(v.dailyRate, ctx.lang) })}{" "}
      <span className="sf-muted">{ctx.d.vatIncluded}</span>
    </p>
  );
}

/* ─────────────────────────────────────────────
   /s/<slug>[/<lang>]
   ───────────────────────────────────────────── */

export function StorefrontHome({
  company,
  vehicles,
  lang,
}: {
  company: PublicCompany;
  vehicles: PublicVehicle[];
  lang: string;
}) {
  const d = storefrontDictionary(lang);
  const ctx: Ctx = { company, lang, d };
  const { settings } = company;
  const title = pickText(settings.title, lang, settings.defaultLanguage) || company.name;
  const tagline = pickText(settings.tagline, lang, settings.defaultLanguage);
  const about = pickText(settings.about, lang, settings.defaultLanguage);

  return (
    <Shell ctx={ctx}>
      <section className="sf-hero">
        <div className="sf-wrap">
          <h1 className="sf-h1">{title}</h1>
          {tagline && <p className="sf-tagline">{tagline}</p>}
          <a href="#contact" className="sf-btn sf-btn--light">
            {d.contactUs}
          </a>
        </div>
      </section>

      {about && (
        <section className="sf-wrap sf-about">
          {about.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}

      <section className="sf-wrap sf-fleet">
        <h2 className="sf-h2">{d.ourFleet}</h2>
        {vehicles.length === 0 ? (
          <p className="sf-muted">{d.noVehicles}</p>
        ) : (
          <div className="sf-grid">
            {vehicles.map((v) => {
              const href = storefrontPath(company.slug, lang, settings.defaultLanguage, v.id);
              return (
                <Link key={v.id} href={href} className="sf-card">
                  <div className="sf-card-img">
                    {v.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cloudinaryThumb(v.photos[0], 640)}
                        alt={`${v.brand} ${v.model}`}
                        loading="lazy"
                      />
                    ) : (
                      <span className="sf-noimg">{d.noPhoto}</span>
                    )}
                  </div>
                  <div className="sf-card-body">
                    <h3 className="sf-card-title">
                      {v.brand} {v.model}
                    </h3>
                    <Specs v={v} d={d} />
                    <Price v={v} ctx={ctx} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </Shell>
  );
}

/* ─────────────────────────────────────────────
   /s/<slug>[/<lang>]/v/<vehicleId>
   ───────────────────────────────────────────── */

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
  const back = storefrontPath(company.slug, lang, company.settings.defaultLanguage);

  return (
    <Shell ctx={ctx} vehicleId={v.id}>
      <div className="sf-wrap sf-vehicle">
        <Link href={back} className="sf-back">
          ← {d.back}
        </Link>
        <div className="sf-vehicle-grid">
          <div>
            {v.photos.length === 0 ? (
              <div className="sf-gallery-main sf-noimg">{d.noPhoto}</div>
            ) : (
              // Gallery με scroll-snap: σύρσιμο στο κινητό, βελάκια/κύλιση στο
              // desktop — χωρίς JavaScript. Οι μικρογραφίες πηγαίνουν σε anchor.
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
            <Price v={v} ctx={ctx} />
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
            <a href="#contact" className="sf-btn sf-btn--primary sf-btn--block">
              {d.contact}
            </a>
          </div>
        </div>
      </div>
    </Shell>
  );
}
