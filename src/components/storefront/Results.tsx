"use client";
// src/components/storefront/Results.tsx
// Κάρτες ομάδων με καρτέλες τύπου (Όλα / Αυτοκίνητα / Μηχανές / ATV) και
// ταξινόμηση. Η καρτέλα και η ταξινόμηση αλλάζουν το URL (type / sort) με
// history.replaceState — ΧΩΡΙΣ νέο φόρτωμα: οι κάρτες έχουν ήδη έρθει.
//
// Οι τιμές έρχονται ΕΤΟΙΜΕΣ από τον server (quote()/fromPrice(), cents)· εδώ
// μόνο εμφανίζονται μέσω formatCents (money.ts).

import { useState } from "react";
import { Bike, Briefcase, CarFront, Cog, DoorOpen, Fuel, Snowflake, Users, Gauge } from "lucide-react";
import { fill, type StorefrontDictionary } from "@/lib/storefront/i18n";
import { formatCents } from "@/lib/public/money";
import { cloudinaryThumb } from "@/lib/vehiclePhotos";
import { filterByType, sortCards, typeTabs, type ResultCard, type SortOrder } from "@/lib/public/catalog";
import type { VehicleType } from "@/lib/public/pricing";
import { PREFILL_EVENT } from "./SearchBox";

interface Props {
  cards: ResultCard[];
  initialType: VehicleType | null;
  initialSort: SortOrder;
  mode: "home" | "search";
  rentalMode: "BOOKING" | "REQUEST";
  lang: string;
  d: StorefrontDictionary;
  title: string;
}

function updateUrl(type: VehicleType | null, sort: SortOrder) {
  try {
    const u = new URL(window.location.href);
    if (type) u.searchParams.set("type", type);
    else u.searchParams.delete("type");
    if (sort === "price_desc") u.searchParams.set("sort", sort);
    else u.searchParams.delete("sort");
    window.history.replaceState(window.history.state, "", u.toString());
  } catch {
    /* χωρίς URL API: απλώς δεν αλλάζει η διεύθυνση */
  }
}

export default function Results({ cards, initialType, initialSort, mode, rentalMode, lang, d, title }: Props) {
  const tabs = typeTabs(cards);
  const [type, setType] = useState<VehicleType | null>(initialType && tabs.includes(initialType) ? initialType : null);
  const [sort, setSort] = useState<SortOrder>(initialSort);
  const shown = sortCards(filterByType(cards, type), sort);

  const chooseType = (t: VehicleType | null) => {
    setType(t);
    updateUrl(t, sort);
  };
  const chooseSort = (s: SortOrder) => {
    setSort(s);
    updateUrl(type, s);
  };

  return (
    <section className="sf-results" aria-labelledby="sf-results-title">
      <div className="sf-results-head">
        <h2 className="sf-h2" id="sf-results-title">
          {title}
        </h2>
        <span className="sf-muted sf-results-count" aria-live="polite">
          {shown.length === 1 ? d.resultsCountOne : fill(d.resultsCount, { n: shown.length })}
        </span>
      </div>

      <div className="sf-results-bar">
        {tabs.length > 0 && (
          <div className="sf-tabs" role="group" aria-label={d.vehicleTypes}>
            <button type="button" className="sf-tab" aria-pressed={type === null} onClick={() => chooseType(null)}>
              {d.tabAll}
            </button>
            {tabs.map((t) => (
              <button key={t} type="button" className="sf-tab" aria-pressed={type === t} onClick={() => chooseType(t)}>
                {d.tabTypes[t] ?? t}
              </button>
            ))}
          </div>
        )}
        <label className="sf-sort">
          <span>{d.sortLabel}</span>
          <select value={sort} onChange={(e) => chooseSort(e.target.value === "price_desc" ? "price_desc" : "price_asc")}>
            <option value="price_asc">{d.sortAsc}</option>
            <option value="price_desc">{d.sortDesc}</option>
          </select>
        </label>
      </div>

      <div className="sf-gcards">
        {shown.map((c, i) => (
          <GroupCard key={c.key} card={c} mode={mode} rentalMode={rentalMode} lang={lang} d={d} eager={i < 2} />
        ))}
      </div>
    </section>
  );
}

function Specs({ card, d }: { card: ResultCard; d: StorefrontDictionary }) {
  const s = card.specs;
  const items: { icon: React.ReactNode; text: string }[] = [];
  if (card.type === "car") items.push({ icon: <Users size={15} aria-hidden />, text: fill(d.seats, { n: s.seats }) });
  items.push({ icon: <Cog size={15} aria-hidden />, text: d.transmissions[s.transmission] ?? s.transmission });
  items.push({ icon: <Fuel size={15} aria-hidden />, text: d.fuels[s.fuel] ?? s.fuel });
  if (s.engineCc && card.type !== "car") items.push({ icon: <Gauge size={15} aria-hidden />, text: fill(d.engineCc, { n: s.engineCc }) });
  if (s.bagsLarge > 0) items.push({ icon: <Briefcase size={15} aria-hidden />, text: fill(d.bagsN, { n: s.bagsLarge }) });
  if (s.bagsSmall > 0) items.push({ icon: <Briefcase size={13} aria-hidden />, text: fill(d.smallBagsN, { n: s.bagsSmall }) });
  if (card.type === "car" && s.doors) items.push({ icon: <DoorOpen size={15} aria-hidden />, text: fill(d.doorsN, { n: s.doors }) });
  if (s.ac && card.type === "car") items.push({ icon: <Snowflake size={15} aria-hidden />, text: d.acShort });
  return (
    <ul className="sf-feats">
      {items.map((it) => (
        <li key={it.text}>
          {it.icon}
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function GroupCard({
  card: c,
  mode,
  rentalMode,
  lang,
  d,
  eager,
}: {
  card: ResultCard;
  mode: "home" | "search";
  rentalMode: "BOOKING" | "REQUEST";
  lang: string;
  d: StorefrontDictionary;
  eager?: boolean;
}) {
  const off = mode === "search" && !c.bookHref;
  const badge = mode === "search" ? c.price?.badge : c.from?.badge;
  const fewLeft = mode === "search" && !off && c.available !== null && c.available > 0 && c.available <= 2;
  const alt = c.similar ? fill(d.orSimilar, { name: c.similar }) : c.name;

  return (
    <article className={`sf-gcard${off ? " is-off" : ""}`}>
      <div className="sf-gcard-img">
        {c.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cloudinaryThumb(c.photoUrl, 640)}
            srcSet={`${cloudinaryThumb(c.photoUrl, 400)} 400w, ${cloudinaryThumb(c.photoUrl, 640)} 640w, ${cloudinaryThumb(c.photoUrl, 960)} 960w`}
            sizes="(min-width: 1080px) 340px, (min-width: 700px) 45vw, 100vw"
            alt={alt}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
          />
        ) : (
          <span className="sf-gcard-ph" role="img" aria-label={d.noPhoto}>
            {c.type === "car" ? <CarFront size={44} aria-hidden /> : <Bike size={44} aria-hidden />}
          </span>
        )}
        {badge && <span className="sf-badge sf-badge--deal">{badge}</span>}
        {fewLeft && (
          <span className="sf-badge sf-badge--few">{c.available === 1 ? d.onlyLeftOne : fill(d.onlyLeft, { n: c.available! })}</span>
        )}
      </div>

      <div className="sf-gcard-body">
        <h3 className="sf-gcard-title">{c.name}</h3>
        {c.similar && <p className="sf-gcard-similar">{fill(d.orSimilar, { name: c.similar })}</p>}
        <Specs card={c} d={d} />

        <div className="sf-gcard-foot">
          {mode === "search" ? (
            off ? (
              <p className="sf-gcard-off">{c.note && c.note !== d.unavailable && c.available ? c.note : d.unavailable}</p>
            ) : c.price ? (
              <>
                <div className="sf-gcard-price">
                  {c.price.listTotalCents > c.price.totalCents && (
                    <s className="sf-was" aria-label={fill(d.wasPrice, { price: formatCents(c.price.listTotalCents, lang) })}>
                      {formatCents(c.price.listTotalCents, lang)}
                    </s>
                  )}
                  <strong>{formatCents(c.price.totalCents, lang)}</strong>
                  <span className="sf-muted">
                    {c.price.days === 1 ? d.daysTotalOne : fill(d.daysTotal, { n: c.price.days })}
                  </span>
                  <span className="sf-gcard-daily">{fill(d.perDay, { price: formatCents(c.price.avgDailyCents, lang) })}</span>
                </div>
                <a href={c.bookHref!} className="sf-btn sf-btn--primary">
                  {rentalMode === "REQUEST" ? d.requestBooking : d.bookNow}
                </a>
              </>
            ) : null
          ) : (
            <>
              <div className="sf-gcard-price">
                {c.from ? (
                  <>
                    {c.from.listDailyCents > c.from.dailyCents && (
                      <s className="sf-was">{formatCents(c.from.listDailyCents, lang)}</s>
                    )}
                    <strong>{fill(d.fromPerDay, { price: formatCents(c.from.dailyCents, lang) })}</strong>
                    <span className="sf-muted">{d.vatIncluded}</span>
                  </>
                ) : (
                  <span className="sf-muted">{d.contactText}</span>
                )}
              </div>
              <button
                type="button"
                className="sf-btn sf-btn--primary"
                onClick={() => window.dispatchEvent(new CustomEvent(PREFILL_EVENT, { detail: { type: c.type } }))}
              >
                {d.seePrices}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
