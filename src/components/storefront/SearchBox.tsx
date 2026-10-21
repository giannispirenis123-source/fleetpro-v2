"use client";
// src/components/storefront/SearchBox.tsx
// Το κουτί αναζήτησης (αρχική + σελίδα αποτελεσμάτων).
//
// · Ίδιοι έλεγχοι με τον server (validateCriteria στο src/lib/public/search.ts)
//   για άμεσο μήνυμα· ο server τους ξανατρέχει ΠΑΝΤΑ.
// · Οι ώρες είναι «ώρα τοίχου» Ελλάδας: ο browser στέλνει το κείμενο όπως είναι.
// · Τα κριτήρια πάνε στο URL (/search?pl=&dl=&from=&to=&age=&type=) → η
//   αναζήτηση μοιράζεται και γυρνά με το «πίσω».

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StorefrontDictionary } from "@/lib/storefront/i18n";
import { fill } from "@/lib/storefront/i18n";
import {
  TIME_SLOTS,
  addDays,
  criteriaToQuery,
  parseCriteria,
  validateCriteria,
  type SearchCriteria,
  type SearchField,
  type SearchProblem,
  type SearchRules,
} from "@/lib/public/search";
import type { VehicleType } from "@/lib/public/pricing";
import DateRangePicker from "./DateRangePicker";

export interface SearchLocationOption {
  slug: string;
  name: string;
  allowPickup: boolean;
  allowDropoff: boolean;
}

export interface SearchAgeOption {
  value: number;
  label: string;
  hint: string;
}

/** Το «Δείτε τιμές» μιας κάρτας στέλνει αυτό το event στο κουτί. */
export const PREFILL_EVENT = "sf:prefill";

interface Props {
  action: string;
  initial: SearchCriteria;
  rules: SearchRules;
  locations: SearchLocationOption[];
  ages: SearchAgeOption[];
  /** "YYYY-MM-DD" — σήμερα, ώρα Ελλάδας (από τον server). */
  today: string;
  lang: string;
  d: StorefrontDictionary;
  /** Σφάλματα που βρήκε ο server στα κριτήρια του URL. */
  serverProblems?: SearchProblem[];
  compact?: boolean;
  id?: string;
}

const messageOf = (p: SearchProblem, lang: string) => (lang === "el" ? p.message.el : p.message.en);

export default function SearchBox({ action, initial, rules, locations, ages, today, lang, d, serverProblems = [], compact, id = "sf-search" }: Props) {
  const router = useRouter();
  const [pl, setPl] = useState(initial.pl ?? "");
  const [dl, setDl] = useState(initial.dl ?? "");
  const [fromDate, setFromDate] = useState(initial.from.slice(0, 10));
  const [fromTime, setFromTime] = useState(initial.from.slice(11, 16) || "10:00");
  const [toDate, setToDate] = useState(initial.to.slice(0, 10));
  const [toTime, setToTime] = useState(initial.to.slice(11, 16) || "10:00");
  const [age, setAge] = useState(initial.age !== null ? String(initial.age) : "");
  const [type, setType] = useState<VehicleType | null>(initial.type);
  const [problems, setProblems] = useState<SearchProblem[]>(serverProblems);
  const [busy, setBusy] = useState(false);
  const [openSignal, setOpenSignal] = useState(0);
  const rootRef = useRef<HTMLFormElement>(null);

  const pickups = locations.filter((l) => l.allowPickup);
  const dropoffs = locations.filter((l) => l.allowDropoff);
  const maxDate = addDays(today, rules.maxAdvanceDays);

  // «Δείτε τιμές» από μια κάρτα: κρατά τον τύπο, ανεβαίνει στο κουτί και ανοίγει τις ημερομηνίες.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const t = (e as CustomEvent<{ type?: VehicleType }>).detail?.type ?? null;
      setType(t);
      rootRef.current?.scrollIntoView({ block: "start" });
      setOpenSignal((n) => n + 1);
    };
    window.addEventListener(PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(PREFILL_EVENT, onPrefill);
  }, []);

  useEffect(() => setBusy(false), [initial.from, initial.to, initial.pl, initial.dl, initial.age]);

  const fieldId = (f: string) => `${id}-${f}`;
  const invalid = (f: SearchField) => problems.some((p) => p.field === f);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Ο τύπος: από το «Δείτε τιμές», αλλιώς η καρτέλα που είναι τώρα στο URL.
    const urlType = parseCriteria(new URLSearchParams(window.location.search)).type;
    const c: SearchCriteria = {
      pl: pl || null,
      // ΠΑΝΤΑ ρητή επιστροφή — και όταν είναι ίδια με την παραλαβή.
      dl: dl || null,
      from: `${fromDate}T${fromTime}`,
      to: `${toDate}T${toTime}`,
      age: age ? Number(age) : null,
      type: type ?? urlType,
    };
    const found = validateCriteria(c, rules, new Date());
    setProblems(found);
    if (found.length > 0) {
      const first = found[0].field;
      // Σφάλμα ημερομηνίας → το αντίστοιχο πεδίο (παραλαβή ή επιστροφή).
      const target = first === "from" ? "dates" : first === "to" ? "dates-end" : first;
      const el = document.getElementById(fieldId(target));
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
      return;
    }
    setBusy(true);
    router.push(`${action}?${criteriaToQuery(c)}`);
  };

  return (
    <form
      ref={rootRef}
      className={`sf-search${compact ? " sf-search--compact" : ""}`}
      onSubmit={submit}
      noValidate
      aria-label={d.searchTitle}
      id={id}
    >
      {/* Ένα grid με ονομασμένες περιοχές (storefront.css): παραλαβή | επιστροφή |
          ηλικία + κουμπί, με τις στήλες ευθυγραμμισμένες. Η σειρά στο DOM =
          η σειρά ανάγνωσης/Tab: παραλαβή → επιστροφή → ηλικία → αναζήτηση. */}
      <DateRangePicker
        idPrefix={id}
        start={fromDate}
        end={toDate}
        minDate={today}
        maxDate={maxDate}
        d={d}
        openSignal={openSignal}
        invalid={{ start: invalid("from"), end: invalid("to") }}
        onChange={(s, e) => {
          setFromDate(s);
          setToDate(e);
        }}
      >
        {(dates) => (
          <div className="sf-search-grid">
            {pickups.length > 0 && (
              <label className={`sf-field sf-search-pl${invalid("pl") ? " is-invalid" : ""}`} htmlFor={fieldId("pl")}>
                <span className="sf-label">{d.pickupLocation}</span>
                <select id={fieldId("pl")} value={pl} onChange={(e) => setPl(e.target.value)} aria-invalid={invalid("pl")}>
                  {!pl && <option value="">—</option>}
                  {pickups.map((l) => (
                    <option key={l.slug} value={l.slug}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="sf-search-fd">{dates.start}</div>
            <label className={`sf-field sf-search-ft${invalid("from") ? " is-invalid" : ""}`} htmlFor={fieldId("from-time")}>
              <span className="sf-label">{d.pickupTime}</span>
              <select id={fieldId("from-time")} value={fromTime} onChange={(e) => setFromTime(e.target.value)}>
                {TIME_SLOTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            {pickups.length > 0 && dropoffs.length > 0 && (
              <label className={`sf-field sf-search-dl${invalid("dl") ? " is-invalid" : ""}`} htmlFor={fieldId("dl")}>
                <span className="sf-label">{d.dropoffLocation}</span>
                <select
                  id={fieldId("dl")}
                  value={dl}
                  required
                  onChange={(e) => {
                    setDl(e.target.value);
                    if (e.target.value) setProblems((ps) => ps.filter((p) => p.field !== "dl"));
                  }}
                  aria-invalid={invalid("dl")}
                  aria-describedby={invalid("dl") ? fieldId("dl-error") : undefined}
                >
                  {/* Καμία προεπιλογή — ούτε με μία μόνο τοποθεσία. */}
                  <option value="">{d.chooseOption}</option>
                  {dropoffs.map((l) => (
                    <option key={l.slug} value={l.slug}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {invalid("dl") && (
                  <span className="sf-field-error" id={fieldId("dl-error")}>
                    {messageOf(problems.find((p) => p.field === "dl")!, lang)}
                  </span>
                )}
              </label>
            )}
            <div className="sf-search-td">{dates.end}</div>
            <label className={`sf-field sf-search-tt${invalid("to") ? " is-invalid" : ""}`} htmlFor={fieldId("to-time")}>
              <span className="sf-label">{d.dropoffTime}</span>
              <select id={fieldId("to-time")} value={toTime} onChange={(e) => setToTime(e.target.value)}>
                {TIME_SLOTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            {ages.length > 0 && (
              <label className={`sf-field sf-search-age${invalid("age") ? " is-invalid" : ""}`} htmlFor={fieldId("age")}>
                <span className="sf-label">{d.driverAge}</span>
                <select id={fieldId("age")} value={age} onChange={(e) => setAge(e.target.value)} aria-invalid={invalid("age")}>
                  {ages.map((a) => (
                    <option key={a.value} value={String(a.value)} title={a.hint || undefined}>
                      {fill(d.ageYears, { label: a.label })}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button type="submit" className="sf-btn sf-btn--primary sf-search-go" disabled={busy}>
              {busy ? d.searching : d.searchButton}
            </button>
          </div>
        )}
      </DateRangePicker>

      <p className="sf-search-note">{d.timesNote}</p>

      {problems.length > 0 && (
        <div className="sf-search-errors" role="alert">
          <strong>{d.checkSearch}</strong>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{messageOf(p, lang)}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
