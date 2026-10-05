"use client";

// Επιλογή οχήματος που πιάνει ελάχιστο χώρο — ΙΔΙΟ component για το νέο
// συμβόλαιο και για την «Αλλαγή οχήματος».
//
// · Πεδίο αναζήτησης (μάρκα, μοντέλο, πινακίδα — vehicleSearch.ts) με έως 6
//   προτάσεις, ΜΟΝΟ από τα διαθέσιμα.
// · «Όλα τα οχήματα»: όλη η λίστα με scroll· τα μη διαθέσιμα γκρι, «Μη
//   διαθέσιμο», δεν επιλέγονται. Η αναζήτηση ισχύει και εκεί.
// · Με την επιλογή μαζεύεται σε μία γραμμή με «Αλλαγή». Esc / πάτημα έξω κλείνει.

import { useEffect, useId, useRef, useState } from "react";
import { Car, List, Search } from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import { searchVehicles } from "@/lib/vehicleSearch";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };
const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL[locale] ?? "el-GR", { style: "currency", currency: "EUR" }).format(n);

export interface PickerVehicle {
  id: string;
  brand: string;
  model: string;
  plate: string;
  /** Χωρίς τιμή (π.χ. αλλαγή οχήματος) δεν εμφανίζεται. */
  dailyRate?: number;
  available: boolean;
}

const SUGGESTIONS = 6;

export default function VehiclePicker({
  vehicles,
  value,
  onChange,
  disabled = false,
  loading = false,
}: {
  vehicles: PickerVehicle[] | null;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const tr = useT();
  const locale = useLocale();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(!value);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [focused, setFocused] = useState(false);

  const list = vehicles ?? [];
  const selected = list.find((v) => v.id === value) ?? null;

  // Χωρίς επιλογή → πάντα σε κατάσταση αναζήτησης.
  useEffect(() => {
    if (!value) setEditing(true);
  }, [value]);

  // Πάτημα έξω κλείνει τις λίστες.
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setShowAll(false);
        setFocused(false);
        if (value) setEditing(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [value]);

  const pick = (id: string) => {
    onChange(id);
    setQuery("");
    setShowAll(false);
    setFocused(false);
    setEditing(false);
  };

  const close = () => {
    setShowAll(false);
    setFocused(false);
    if (value) setEditing(false);
  };

  const suggestions =
    focused && !showAll && query.trim()
      ? searchVehicles(list.filter((v) => v.available), query, SUGGESTIONS)
      : [];
  const all = showAll ? searchVehicles(list, query) : [];

  const row = (v: PickerVehicle) => (
    <>
      <Car size={14} />
      <span className="dash-vpick-name">
        <strong>
          {v.brand} {v.model}
        </strong>{" "}
        · {v.plate}
        {!v.available && <span className="dash-vpick-busy"> · {tr("vehiclePicker.unavailable")}</span>}
      </span>
      {v.dailyRate !== undefined && (
        <span className="dash-vpick-price">
          {eur(v.dailyRate, locale)}
          <small> {tr("contracts.perDay")}</small>
        </span>
      )}
    </>
  );

  if (!editing && selected) {
    return (
      <div className={`dash-vpick-chosen ${selected.available ? "" : "busy"}`} ref={rootRef}>
        {row(selected)}
        {!disabled && (
          <button
            type="button"
            className="dash-btn"
            onClick={() => {
              setEditing(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            {tr("vehiclePicker.change")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="dash-vpick" ref={rootRef} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="dash-vpick-bar">
        <label className="dash-vpick-search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            disabled={disabled}
            role="combobox"
            aria-expanded={suggestions.length > 0 || showAll}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder={tr("vehiclePicker.placeholder")}
            onFocus={() => setFocused(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocused(true);
            }}
          />
        </label>
        <button
          type="button"
          className={`dash-btn ${showAll ? "dash-btn--primary" : ""}`}
          disabled={disabled}
          aria-pressed={showAll}
          onClick={() => setShowAll((s) => !s)}
        >
          <List size={15} /> {tr("vehiclePicker.all")}
        </button>
      </div>

      {loading && <p className="dash-form-note">{tr("contracts.loading")}</p>}

      {(suggestions.length > 0 || showAll) && (
        <div className="dash-vpick-list" id={listId} role="listbox">
          {(showAll ? all : suggestions).map((v) => (
            <button
              key={v.id}
              type="button"
              role="option"
              aria-selected={v.id === value}
              aria-disabled={!v.available}
              disabled={!v.available}
              className={`dash-vpick-item ${v.available ? "" : "busy"} ${v.id === value ? "on" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => v.available && pick(v.id)}
            >
              {row(v)}
            </button>
          ))}
          {showAll && all.length === 0 && <p className="dash-form-note">{tr("vehiclePicker.none")}</p>}
        </div>
      )}
      {!showAll && focused && query.trim() && suggestions.length === 0 && !loading && (
        <p className="dash-form-note">{tr("vehiclePicker.noneAvailable")}</p>
      )}
    </div>
  );
}
