"use client";

// Αναγνώριση παλιού πελάτη: όσο γράφεις στα πεδία του ΚΥΡΙΟΥ οδηγού
// (νέο συμβόλαιο), εμφανίζονται κάτω από το πεδίο οι πελάτες που
// ταιριάζουν. Ένα πάτημα → συμπληρώνονται όλα τα στοιχεία του.
//
// Debounce 300ms, ελάχιστο 2 χαρακτήρες (3 ψηφία σε τηλέφωνο/έγγραφο). Η
// ανοχή σε τόνους/κεφαλαία/+30 είναι στον server (customerMatch.ts).

import { useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { searchQueryFor, type CustomerSearchField } from "@/lib/customerMatch";
import type { WalkInCustomer } from "@/lib/walkIn";

export function useCustomerSuggest(enabled: boolean) {
  const [field, setField] = useState<CustomerSearchField | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WalkInCustomer[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    if (!enabled || !field || !searchQueryFor(field, query)) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ field, q: query });
        const res = await fetch(`/api/contracts/walk-in/customers?${params}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (mine === seq.current) setResults(res.ok ? body.data.customers : []);
      } catch {
        if (mine === seq.current) setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [enabled, field, query]);

  return {
    field,
    results,
    /** Κλήση σε κάθε πληκτρολόγηση ενός πεδίου του κύριου οδηγού. */
    typed: (f: CustomerSearchField, value: string) => {
      setField(f);
      setQuery(value);
    },
    close: () => {
      seq.current++;
      setField(null);
      setResults([]);
    },
  };
}

export function SuggestList({
  results,
  onPick,
}: {
  results: WalkInCustomer[];
  onPick: (c: WalkInCustomer) => void;
}) {
  const tr = useT();
  if (results.length === 0) return null;
  return (
    <div className="dash-suggest" role="listbox" aria-label={tr("contracts.suggestTitle")}>
      <span className="dash-suggest-title">{tr("contracts.suggestTitle")}</span>
      {results.map((c) => (
        <button
          key={c.id}
          type="button"
          role="option"
          aria-selected={false}
          className="dash-suggest-item"
          // Χωρίς blur του πεδίου στο πάτημα (αλλιώς η λίστα κλείνει πριν το click).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        >
          <UserRound size={14} />
          <span className="dash-suggest-name">
            <strong>{c.name}</strong>
            {c.isBlacklisted && (
              <span className="dash-status dash-status--bad">{tr("walkIn.blacklisted")}</span>
            )}
          </span>
          <span className="dash-suggest-meta">
            {c.phone || "—"} · {c.bookings} {tr("contracts.bookingsCount")}
          </span>
        </button>
      ))}
    </div>
  );
}
