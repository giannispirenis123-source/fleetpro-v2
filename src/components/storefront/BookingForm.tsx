"use client";
// src/components/storefront/BookingForm.tsx
// Η φόρμα κράτησης του δημόσιου site.
//
// · Πρόσθετα/ασφάλεια: κάθε αλλαγή ξαναζητά την τιμή από τον SERVER
//   (/api/public/quote — ίδια μηχανή με όλη την εφαρμογή). Καμία τιμή εδώ.
// · Τα στοιχεία του πελάτη ΠΟΤΕ στο URL· στέλνονται μόνο με POST.
// · Μηνύματα σφάλματος δίπλα στο πεδίο (aria-invalid/aria-describedby).
// · Το κουμπί κλειδώνει στην υποβολή (καμία διπλή κράτηση).

import { useEffect, useRef, useState } from "react";
import { fill, type StorefrontDictionary } from "@/lib/storefront/i18n";
import { formatCents } from "@/lib/public/money";
import { textFor } from "@/lib/public/text";
import { PHONE_COUNTRIES, NOTES_MAX } from "@/lib/public/bookingRequest";
import type { PublicExtraOption, PublicQuote } from "@/lib/public/bookingView";

type Msg = { el?: string; en?: string };

interface Props {
  slug: string;
  lang: string;
  cardKey: string;
  criteria: { pl: string | null; dl: string | null; from: string; to: string; age: number | null };
  /** Η διεύθυνση της σελίδας χωρίς query (για την «Ενημέρωση τιμής»). */
  bookPath: string;
  query: string;
  d: StorefrontDictionary;
  submitLabel: string;
  options: PublicExtraOption[];
  initialQuote: PublicQuote;
  needsFlight: boolean;
}

const DRAFT_KEY = "sf-book-draft";

interface Contact {
  firstName: string;
  lastName: string;
  email: string;
  phoneCountry: string;
  phone: string;
  birthDate: string;
  flightNumber: string;
  notes: string;
  acceptTerms: boolean;
}

const EMPTY: Contact = {
  firstName: "",
  lastName: "",
  email: "",
  phoneCountry: "+30",
  phone: "",
  birthDate: "",
  flightNumber: "",
  notes: "",
  acceptTerms: false,
};

export default function BookingForm({ slug, lang, cardKey, criteria, bookPath, query, d, submitLabel, options, initialQuote, needsFlight }: Props) {
  const t = (m: Msg | undefined) => (m ? textFor(m as Record<string, string>, lang) : "");
  const extrasOpts = options.filter((o) => o.kind === "EXTRA");
  const insuranceOpts = options.filter((o) => o.kind === "INSURANCE");
  const defaultInsurance = insuranceOpts.find((o) => o.isDefault)?.id ?? insuranceOpts[0]?.id ?? null;

  const [extras, setExtras] = useState<Record<string, number>>({});
  const [insuranceId, setInsuranceId] = useState<string | null>(defaultInsurance);
  const [quote, setQuote] = useState<PublicQuote>(initialQuote);
  const [quoting, setQuoting] = useState(false);
  const [contact, setContact] = useState<Contact>(EMPTY);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [ageUpdate, setAgeUpdate] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstRender = useRef(true);

  // Μετά την «Ενημέρωση τιμής» (νέα ηλικία στο URL) τα στοιχεία επιστρέφουν
  // από το sessionStorage της καρτέλας — ποτέ από το URL.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { key: string; contact: Contact; extras: Record<string, number>; insuranceId: string | null };
        if (saved.key === cardKey) {
          setContact({ ...EMPTY, ...saved.contact });
          setExtras(saved.extras ?? {});
          setInsuranceId(saved.insuranceId ?? defaultInsurance);
        }
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      /* χωρίς sessionStorage: απλώς κενή φόρμα */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extrasPayload = () => Object.entries(extras).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty }));

  // ── Νέα τιμή από τον server σε κάθε αλλαγή πρόσθετων/ασφάλειας ──
  const extrasKey = JSON.stringify([extras, insuranceId]);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (Object.keys(extras).length === 0 && insuranceId === defaultInsurance) return;
    }
    let alive = true;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/public/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, key: cardKey, criteria, extras: extrasPayload(), insuranceId }),
        });
        const body = await res.json().catch(() => ({}));
        if (alive && res.ok) setQuote(body.data);
      } finally {
        if (alive) setQuoting(false);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extrasKey]);

  const set = <K extends keyof Contact>(k: K, v: Contact[K]) => {
    setContact((c) => ({ ...c, [k]: v }));
    setErrors((e) => {
      const { [k]: _gone, ...rest } = e;
      return rest;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError("");
    setAgeUpdate(null);
    try {
      const res = await fetch("/api/public/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          lang,
          key: cardKey,
          criteria,
          extras: extrasPayload(),
          insuranceId,
          ...contact,
          website,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.data?.url) {
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {
          /* τίποτα */
        }
        window.location.assign(body.data.url);
        return; // το κουμπί μένει κλειδωμένο ως τη νέα σελίδα
      }
      const fieldErrors: Record<string, string> = {};
      for (const fe of body.fieldErrors ?? []) fieldErrors[fe.field] = t(fe.message);
      setErrors(fieldErrors);
      setFormError(t(body.message) || "—");
      if (typeof body.ageUpdate === "number") setAgeUpdate(body.ageUpdate);
      const first = Object.keys(fieldErrors)[0];
      if (first) document.getElementById(`bk-${first}`)?.focus();
    } catch {
      setFormError(lang === "el" ? "Πρόβλημα σύνδεσης. Δοκιμάστε ξανά." : "Connection problem. Please try again.");
    }
    setSubmitting(false);
  };

  const updatePrice = () => {
    if (ageUpdate === null) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ key: cardKey, contact, extras, insuranceId }));
    } catch {
      /* τίποτα */
    }
    const q = new URLSearchParams(query);
    q.set("age", String(ageUpdate));
    window.location.assign(`${bookPath}?${q.toString()}`);
  };

  const field = (name: keyof Contact, label: string, input: React.ReactNode, hint?: string) => (
    <div className={`sf-bk-field${errors[name] ? " is-invalid" : ""}`}>
      <label htmlFor={`bk-${name}`}>{label}</label>
      {input}
      {hint && <small id={`bk-${name}-hint`}>{hint}</small>}
      {errors[name] && (
        <span className="sf-bk-err" id={`bk-${name}-err`} role="alert">
          {errors[name]}
        </span>
      )}
    </div>
  );
  const aria = (name: string, hint = false) => ({
    id: `bk-${name}`,
    "aria-invalid": !!errors[name] || undefined,
    "aria-describedby": [errors[name] ? `bk-${name}-err` : "", hint ? `bk-${name}-hint` : ""].filter(Boolean).join(" ") || undefined,
  });

  const price = (o: PublicExtraOption) =>
    `${formatCents(o.priceCents, lang)} ${o.priceType === "per_day" ? d.perDayShort : d.perRental}`;

  return (
    <form className="sf-bk" onSubmit={submit} noValidate>
      {(extrasOpts.length > 0 || insuranceOpts.length > 0) && (
        <section className="sf-bk-box" aria-labelledby="bk-extras-title">
          {insuranceOpts.length > 0 && (
            <fieldset className="sf-bk-set">
              <legend id="bk-extras-title">{d.insuranceTitle}</legend>
              {insuranceOpts.map((o) => (
                <label key={o.id} className="sf-bk-opt">
                  <input
                    type="radio"
                    name="insurance"
                    checked={insuranceId === o.id}
                    onChange={() => setInsuranceId(o.id)}
                  />
                  <span className="sf-bk-opt-name">
                    {o.name}
                    {o.excessCents !== null && (
                      <small> · {fill(d.excessShort, { amount: formatCents(o.excessCents, lang) })}</small>
                    )}
                  </span>
                  <span className="sf-bk-opt-price">{price(o)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {extrasOpts.length > 0 && (
            <fieldset className="sf-bk-set">
              <legend>{d.extrasTitle}</legend>
              {extrasOpts.map((o) => {
                const qty = extras[o.id] ?? 0;
                return (
                  <div key={o.id} className="sf-bk-opt">
                    <input
                      type="checkbox"
                      id={`bk-x-${o.id}`}
                      checked={qty > 0}
                      onChange={(e) => setExtras((x) => ({ ...x, [o.id]: e.target.checked ? 1 : 0 }))}
                    />
                    <label htmlFor={`bk-x-${o.id}`} className="sf-bk-opt-name">
                      {o.name}
                    </label>
                    {qty > 0 && o.maxQuantity > 1 && (
                      <select
                        aria-label={`${d.qtyLabel}: ${o.name}`}
                        value={qty}
                        onChange={(e) => setExtras((x) => ({ ...x, [o.id]: Number(e.target.value) }))}
                      >
                        {Array.from({ length: o.maxQuantity }, (_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {i + 1}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="sf-bk-opt-price">{price(o)}</span>
                  </div>
                );
              })}
            </fieldset>
          )}
        </section>
      )}

      <section className="sf-bk-box" aria-labelledby="bk-price-title" aria-busy={quoting}>
        <h2 className="sf-h3" id="bk-price-title">
          {d.priceBreakdown} {quoting && <small className="sf-muted">· {d.priceUpdating}</small>}
        </h2>
        <table className="sf-lines">
          <tbody>
            {quote.lines.map((l, i) => (
              <tr key={i} className={l.totalCents < 0 ? "is-discount" : undefined}>
                <th scope="row">
                  {t(l.label)}
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
        <p className="sf-bk-pay">{d.payAtPickup}</p>
      </section>

      <section className="sf-bk-box" aria-labelledby="bk-details-title">
        <h2 className="sf-h3" id="bk-details-title">
          {d.yourDetails}
        </h2>
        <div className="sf-bk-grid">
          {field("firstName", d.firstName, <input {...aria("firstName")} type="text" autoComplete="given-name" required maxLength={100} value={contact.firstName} onChange={(e) => set("firstName", e.target.value)} />)}
          {field("lastName", d.lastName, <input {...aria("lastName")} type="text" autoComplete="family-name" required maxLength={100} value={contact.lastName} onChange={(e) => set("lastName", e.target.value)} />)}
          {field("email", d.emailLabel, <input {...aria("email")} type="email" inputMode="email" autoComplete="email" required maxLength={160} value={contact.email} onChange={(e) => set("email", e.target.value)} />)}
          {field(
            "phone",
            d.phoneLabel,
            <div className="sf-bk-phone">
              <select aria-label={d.countryCode} value={contact.phoneCountry} onChange={(e) => set("phoneCountry", e.target.value)} autoComplete="tel-country-code">
                {PHONE_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input {...aria("phone")} type="tel" inputMode="tel" autoComplete="tel-national" required maxLength={30} value={contact.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          )}
          {field("birthDate", d.birthDate, <input {...aria("birthDate")} type="date" autoComplete="bday" required value={contact.birthDate} max={criteria.from.slice(0, 10)} onChange={(e) => set("birthDate", e.target.value)} />)}
          {needsFlight &&
            field(
              "flightNumber",
              d.flightNumber,
              <input {...aria("flightNumber", true)} type="text" autoComplete="off" maxLength={12} value={contact.flightNumber} onChange={(e) => set("flightNumber", e.target.value.toUpperCase())} />,
              d.flightHint
            )}
        </div>
        {field(
          "notes",
          d.notesLabel,
          <textarea {...aria("notes")} rows={3} maxLength={NOTES_MAX} value={contact.notes} onChange={(e) => set("notes", e.target.value)} />
        )}

        {/* Honeypot: κρυφό για ανθρώπους (και για αναγνώστες οθόνης) — αν γεμίσει, είναι bot. */}
        <div className="sf-hp" aria-hidden="true">
          <label>
            Website
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>

        <div className={`sf-bk-terms${errors.acceptTerms ? " is-invalid" : ""}`}>
          <input {...aria("acceptTerms")} type="checkbox" checked={contact.acceptTerms} onChange={(e) => set("acceptTerms", e.target.checked)} />
          <label htmlFor="bk-acceptTerms">{d.acceptTerms}</label>
          {errors.acceptTerms && (
            <span className="sf-bk-err" id="bk-acceptTerms-err" role="alert">
              {errors.acceptTerms}
            </span>
          )}
        </div>
      </section>

      {formError && (
        <div className="sf-search-errors" role="alert">
          {formError}
          {ageUpdate !== null && (
            <div>
              <button type="button" className="sf-btn sf-btn--ghost sf-btn--sm" onClick={updatePrice}>
                {d.updatePrice}
              </button>
            </div>
          )}
        </div>
      )}

      <button type="submit" className="sf-btn sf-btn--primary sf-btn--block sf-bk-submit" disabled={submitting || quoting}>
        {submitting ? d.submitting : submitLabel} · {formatCents(quote.totalCents, lang)}
      </button>
    </form>
  );
}
