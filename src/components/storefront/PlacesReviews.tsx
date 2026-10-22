// src/components/storefront/PlacesReviews.tsx
// Αρχική του site: «Μέρη για επίσκεψη» (carousel) και «Κριτικές πελατών».
// Server components — δέχονται ΜΟΝΟ δημόσια DTO. Κενή λίστα → τίποτα (ούτε τίτλος).

import Link from "next/link";
import { fill, formatDay, type StorefrontDictionary } from "@/lib/storefront/i18n";
import { sitePath, type SitePathCompany } from "@/lib/storefront/slug";
import { cloudinaryThumb } from "@/lib/vehiclePhotos";
import type { PublicPlaceCard } from "@/lib/public/places";
import type { PublicReview, ReviewSection } from "@/lib/public/reviews";
import Carousel from "./Carousel";

const CARD_WIDTHS = [320, 480, 640];

export function PlacesSection({
  company,
  lang,
  d,
  places,
}: {
  company: SitePathCompany;
  lang: string;
  d: StorefrontDictionary;
  places: PublicPlaceCard[];
}) {
  if (places.length === 0) return null;
  return (
    <section className="sf-wrap sf-section sf-places" aria-labelledby="sf-places-title">
      <h2 className="sf-h2" id="sf-places-title">
        {d.placesTitle}
      </h2>
      <p className="sf-muted">{d.placesIntro}</p>
      <Carousel label={d.placesTitle} prevLabel={d.carouselPrev} nextLabel={d.carouselNext} slideLabel={d.slideOf} className="sf-places-carousel">
        {places.map((p) => (
          <Link key={p.slug} href={sitePath(company, lang, { placeSlug: p.slug })} className="sf-place-card">
            <span className="sf-place-img">
              {p.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cloudinaryThumb(p.coverUrl, 480)}
                  srcSet={CARD_WIDTHS.map((w) => `${cloudinaryThumb(p.coverUrl!, w)} ${w}w`).join(", ")}
                  sizes="(max-width: 640px) 78vw, 300px"
                  alt={p.name}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="sf-noimg" aria-hidden="true" />
              )}
            </span>
            <span className="sf-place-name">{p.name}</span>
            {p.short && <span className="sf-place-short">{p.short}</span>}
          </Link>
        ))}
      </Carousel>
    </section>
  );
}

function Stars({ n, d }: { n: number; d: StorefrontDictionary }) {
  const full = Math.round(n);
  return (
    <span className="sf-stars" role="img" aria-label={fill(d.starsLabel, { n: String(n).replace(".", ",") })}>
      {"★".repeat(full)}
      <span className="sf-stars-off">{"★".repeat(5 - full)}</span>
    </span>
  );
}

function ReviewCard({ r, d, lang }: { r: PublicReview; d: StorefrontDictionary; lang: string }) {
  const date = r.date ? `${formatDay(r.date, d)} ${r.date.slice(0, 4)}` : null;
  return (
    <article className="sf-review">
      <header className="sf-review-head">
        <strong className="sf-review-author">
          {r.authorUrl ? (
            <a href={r.authorUrl} target="_blank" rel="noopener noreferrer nofollow">
              {r.author}
            </a>
          ) : (
            r.author
          )}
        </strong>
        <Stars n={r.rating} d={d} />
      </header>
      {/* Το κείμενο ΟΠΩΣ το δίνει η πηγή — καμία περικοπή. */}
      <p className="sf-review-text" lang={r.source === "google" ? undefined : lang}>
        {r.text}
      </p>
      <footer className="sf-review-foot">
        {date && <time dateTime={r.date!}>{date}</time>}
        <span className={`sf-review-src is-${r.source}`}>
          {r.sourceUrl ? (
            <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
              {r.source === "google" ? d.sourceGoogle : d.readSource}
            </a>
          ) : r.source === "google" ? (
            d.sourceGoogle
          ) : (
            d.sourceSite
          )}
        </span>
      </footer>
    </article>
  );
}

export function ReviewsSection({
  lang,
  d,
  section,
}: {
  lang: string;
  d: StorefrontDictionary;
  section: ReviewSection | null;
}) {
  if (!section || section.reviews.length + section.count === 0) return null;
  const sources =
    section.googleCount > 0 && section.siteCount > 0
      ? d.reviewsSources
      : section.googleCount > 0
        ? d.reviewsSourcesGoogle
        : d.reviewsSourcesSite;
  return (
    <section className="sf-wrap sf-section sf-reviews" aria-labelledby="sf-reviews-title">
      <h2 className="sf-h2" id="sf-reviews-title">
        {d.reviewsTitle}
      </h2>
      <div className="sf-reviews-summary">
        <span className="sf-reviews-score">{section.rating.toLocaleString(lang === "el" ? "el-GR" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
        <Stars n={section.rating} d={d} />
        <span className="sf-muted">
          {fill(d.reviewsSummary, { rating: String(section.rating).replace(".", lang === "el" ? "," : "."), count: section.count })}
        </span>
      </div>
      <p className="sf-muted sf-small">
        {sources}
        {section.googleUrl && (
          <>
            {" · "}
            <a href={section.googleUrl} target="_blank" rel="noopener noreferrer nofollow">
              {d.seeOnGoogle}
            </a>
          </>
        )}
      </p>
      {section.reviews.length > 0 && (
        <Carousel label={d.reviewsTitle} prevLabel={d.carouselPrev} nextLabel={d.carouselNext} slideLabel={d.slideOf} className="sf-reviews-carousel">
          {section.reviews.map((r) => (
            <ReviewCard key={r.key} r={r} d={d} lang={lang} />
          ))}
        </Carousel>
      )}
    </section>
  );
}
