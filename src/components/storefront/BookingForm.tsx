"use client";
// src/components/storefront/BookingForm.tsx
// Η φόρμα κράτησης του δημόσιου site.
//
// · Πρόσθετα/ασφάλεια: κάθε αλλαγή ξαναζητά την τιμή από τον SERVER
//   (/api/public/quote — ίδια μηχανή με όλη την εφαρμογή). Καμία τιμή εδώ.
// · Ασφάλεια: ΠΡΟΑΙΡΕΤΙΚΗ. Αρχική επιλογή «Χωρίς πρόσθετη ασφάλεια»· χωρίς
//   επίπεδα για τον τύπο οχήματος η ενότητα δεν εμφανίζεται καθόλου.
// · Τα στοιχεία του πελάτη ΠΟΤΕ στο URL· στέλνονται μόνο με POST.
// · Μηνύματα σφάλματος δίπλα στο πεδίο (aria-invalid/aria-describedby).
// · Το κουμπί κλειδώνει στην υποβολή (καμία διπλή κράτηση).

import { useEffect, useRef, useState } from "react";
import { fill, type StorefrontDictionary } from "@/lib/storefront/i18n";
import { formatCents } from "@/lib/public/money";
import { textFor } from "@/lib/public/text";
import { PHONE_COUNTRIES, NOTES_MAX } from "@/lib/public/bookingRequest";
import { paymentSplit, type PaymentMethod } from "@/lib/public/payments";
import type { PublicExtraOption, PublicInsuranceOption, PublicQuote } from "@/lib/public/bookingView";

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
  /** Τα επίπεδα ασφάλειας για τον τύπο του οχήματος (κενό = χωρίς ενότητα). */
  insurance: PublicInsuranceOption[];
  initialQuote: PublicQuote;
  needsFlight: boolean;
  /** Οι τρόποι πληρωμής που ισχύουν (ο server τους ξαναελέγχει) + πόσο χρεώνεται online. */
  payment: { methods: PaymentMethod[]; amountType: string; depositPercent: number };
  /** Οι όροι και το απόρρητο της ΙΔΙΑΣ εταιρίας (ανοίγουν σε νέα καρτέλα — η φόρμα μένει). */
  legal: { termsHref: string; privacyHref: string };
}

/** «… τους {terms} … στην {privacy}.» → κείμενο με links. */
function TermsLabel({ d, legal }: { d: StorefrontDictionary; legal: Props["legal"] }) {
  const parts = d.acceptTermsRich.split(/(\{terms\}|\{privacy\})/);
  return (
    <>
      {parts.map((p, i) =>
        p === "{terms}" ? (
          <a key={i} href={legal.termsHref} target="_blank" rel="noopener">
            {d.termsLink}
          </a>
        ) : p === "{privacy}" ? (
          <a key={i} href={legal.privacyHref} target="_blank" rel="noopener">
            {d.privacyLink}
          </a>
        ) : (
          p
        )
      )}
    </>
  );
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

export default function BookingForm({ slug, lang, cardKey, criteria, bookPath, query, d, submitLabel, options, insurance, initialQuote, needsFlight, payment, legal }: Props) {
  const t = (m: Msg | undefined) => (m ? textFor(m as Record<string, string>, lang) : "");
  const extrasOpts = options;
  const insuranceOpts = insurance;

  const [extras, setExtras] = useState<Record<string, number>>({});
  // Καμία προεπιλογή: ο πελάτης διαλέγει ασφάλεια ΜΟΝΟ αν θέλει.
  const [insuranceId, setInsuranceId] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quote, setQuote] = useState<PublicQuote>(initialQuote);
  const [quoting, setQuoting] = useState(false);
  const [contact, setContact] = useState<Contact>(EMPTY);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [ageUpdate, setAgeUpdate] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Με ΔΥΟ τρόπους: καμία προεπιλογή (υποχρεωτική ρητή επιλογή). Με έναν: αυτός.
  const [method, setMethod] = useState<PaymentMethod | null>(payment.methods.length === 1 ? payment.methods[0] : null);
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
          setInsuranceId(saved.insuranceId && insuranceOpts.some((o) => o.id === saved.insuranceId) ? saved.insuranceId : null);
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
      if (Object.keys(extras).length === 0 && insuranceId === null) return;
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
        if (!alive) return;
        if (res.ok) {
          setQuote(body.data);
          setQuoteError("");
        } else if (body.message) {
          // Π.χ. το επίπεδο απενεργοποιήθηκε στο μεταξύ: πίσω στο «χωρίς ασφάλεια».
          setQuoteError(t(body.message));
          setInsuranceId(null);
        }
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
    if (!method) {
      setErrors((x) => ({ ...x, paymentMethod: t({ el: "Διαλέξτε τρόπο πληρωμής.", en: "Choose a payment method." }) }));
      const el = document.getElementById("bk-paymentMethod");
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      (el?.querySelector("input") as HTMLInputElement | null)?.focus({ preventScroll: true });
      return;
    }
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
          paymentMethod: method,
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
      if (first === "paymentMethod") document.getElementById("bk-paymentMethod")?.scrollIntoView({ block: "center" });
      else if (first) document.getElementById(`bk-${first}`)?.focus();
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

  // Ποσό τώρα / στην παραλαβή — μόνο για εμφάνιση· ο server το ξαναβγάζει από την αποθηκευμένη τιμή.
  const split = paymentSplit(quote.totalCents, payment.amountType, payment.depositPercent);

  const price = (o: PublicExtraOption) =>
    `${formatCents(o.priceCents, lang)} ${o.priceType === "per_day" ? d.perDayShort : d.perRental}`;

  return (
    <form className="sf-bk" onSubmit={submit} noValidate>
      {extrasOpts.length > 0 && (
        <section className="sf-bk-box" aria-labelledby="bk-extras-title">
          <fieldset className="sf-bk-set">
            <legend id="bk-extras-title">{d.extrasTitle}</legend>
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
        </section>
      )}

      {/* Ασφάλεια: ΠΡΟΑΙΡΕΤΙΚΗ — χωρίς επίπεδα η ενότητα δεν υπάρχει καθόλου. */}
      {insuranceOpts.length > 0 && (
        <section className="sf-bk-box">
          <fieldset className="sf-bk-set sf-ins">
            <legend className="sf-h3">{d.insuranceTitle}</legend>
            <p className="sf-muted sf-small">{d.insuranceIntro}</p>
            <div className="sf-ins-list">
              <label className={`sf-ins-card${insuranceId === null ? " is-on" : ""}`}>
                <input type="radio" name="insurance" checked={insuranceId === null} onChange={() => setInsuranceId(null)} />
                <span className="sf-ins-body">
                  <span className="sf-ins-name">{d.noExtraInsurance}</span>
                  <span className="sf-ins-desc">{d.noExtraInsuranceHint}</span>
                </span>
                <span className="sf-ins-price">{formatCents(0, lang)}</span>
              </label>
              {insuranceOpts.map((o) => {
                const on = insuranceId === o.id;
                const descId = `bk-ins-${o.id}-desc`;
                return (
                  <label key={o.id} className={`sf-ins-card${on ? " is-on" : ""}`}>
                    <input type="radio" name="insurance" checked={on} onChange={() => setInsuranceId(o.id)} aria-describedby={descId} />
                    <span className="sf-ins-body" id={descId}>
                      <span className="sf-ins-name">{o.name}</span>
                      {o.description && <span className="sf-ins-desc">{o.description}</span>}
                      {o.coverages.length > 0 && (
                        <ul className="sf-ins-covers">
                          {o.coverages.map((c, i) => (
                            <li key={i}>
                              <span aria-hidden="true">✓</span> {c}
                            </li>
                          ))}
                        </ul>
                      )}
                      {o.excessCents !== null && (
                        <span className="sf-ins-desc">{fill(d.insuranceExcess, { amount: formatCents(o.excessCents, lang) })}</span>
                      )}
                    </span>
                    <span className="sf-ins-price">
                      <strong>
                        +{formatCents(o.priceCents, lang)} {o.priceType === "per_day" ? d.perDayShort : d.perRental}
                      </strong>
                      {o.priceType === "per_day" && (
                        <small>{fill(d.insuranceTotal, { amount: formatCents(o.totalCents, lang) })}</small>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            {quoteError && (
              <p className="sf-bk-err" role="alert">
                {quoteError}
              </p>
            )}
          </fieldset>
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
        {!payment.methods.includes("ONLINE") && <p className="sf-bk-pay">{d.payAtPickup}</p>}
      </section>

      {/* Πληρωμή: μόνο όταν η εταιρία δέχεται online (ο server ελέγχει ξανά τι ισχύει). */}
      {payment.methods.includes("ONLINE") && (
        <section className="sf-bk-box" aria-labelledby="bk-pay-title">
          <fieldset
            className={`sf-bk-set sf-pay${errors.paymentMethod ? " is-invalid" : ""}`}
            id="bk-paymentMethod"
            aria-invalid={!!errors.paymentMethod || undefined}
            aria-describedby={errors.paymentMethod ? "bk-paymentMethod-err" : undefined}
          >
            <legend className="sf-h3" id="bk-pay-title">
              {d.payMethodTitle}
            </legend>
            {payment.methods.map((m) => {
              const on = method === m;
              return (
                <label key={m} className={`sf-ins-card sf-pay-card${on ? " is-on" : ""}`}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={m}
                    checked={on}
                    onChange={() => {
                      setMethod(m);
                      setErrors(({ paymentMethod: _gone, ...rest }) => rest);
                    }}
                  />
                  <span className="sf-ins-body">
                    <span className="sf-ins-name">{m === "ONLINE" ? d.payOnlineNow : d.payOnPickupOption}</span>
                    <span className="sf-ins-desc">{m === "ONLINE" ? d.payOnlineHint : d.payPickupHint}</span>
                    {m === "ONLINE" && (
                      <span className="sf-pay-split">
                        <strong>{fill(d.payNowAmount, { amount: formatCents(split.nowCents, lang) })}</strong>
                        {split.laterCents > 0 && <span>{fill(d.payLaterAmount, { amount: formatCents(split.laterCents, lang) })}</span>}
                      </span>
                    )}
                  </span>
                  <span className="sf-ins-price">
                    <strong>{formatCents(m === "ONLINE" ? split.nowCents : 0, lang)}</strong>
                  </span>
                </label>
              );
            })}
            {errors.paymentMethod && (
              <span className="sf-bk-err" id="bk-paymentMethod-err" role="alert">
                {errors.paymentMethod}
              </span>
            )}
          </fieldset>
        </section>
      )}

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
          <label htmlFor="bk-acceptTerms">
            <TermsLabel d={d} legal={legal} />
          </label>
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
        {submitting ? d.submitting : method === "ONLINE" ? d.payContinue : submitLabel} ·{" "}
        {formatCents(method === "ONLINE" ? split.nowCents : quote.totalCents, lang)}
      </button>
    </form>
  );
}
