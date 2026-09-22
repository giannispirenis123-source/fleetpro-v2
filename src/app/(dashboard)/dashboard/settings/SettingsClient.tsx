"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Inbox, Check, Timer } from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  formatPrepTime,
  joinPrepTime,
  splitPrepTime,
  MAX_PREP_MINUTES,
} from "@/lib/prepTime";

const RENTAL_MODES = ["BOOKING", "REQUEST"] as const;
type RentalMode = (typeof RENTAL_MODES)[number];

const MODE_ICON = {
  BOOKING: CalendarCheck,
  REQUEST: Inbox,
} as const;

export default function SettingsClient({
  companyName,
  initialRentalMode,
  initialPrepMinutes,
}: {
  companyName: string;
  initialRentalMode: string;
  initialPrepMinutes: number;
}) {
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();

  const [rentalMode, setRentalMode] = useState<string>(initialRentalMode);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [prepMinutes, setPrepMinutes] = useState(initialPrepMinutes);
  const initialSplit = splitPrepTime(initialPrepMinutes);
  const [prepHours, setPrepHours] = useState(String(initialSplit.hours));
  const [prepMins, setPrepMins] = useState(String(initialSplit.minutes));
  const [savingPrep, setSavingPrep] = useState(false);
  const [prepSaved, setPrepSaved] = useState(false);
  const [prepError, setPrepError] = useState("");

  const draftPrep = joinPrepTime(
    Number(prepHours) || 0,
    Number(prepMins) || 0
  );
  const prepDirty = draftPrep !== prepMinutes;

  const savePrepTime = async () => {
    if (savingPrep || !prepDirty) return;

    setSavingPrep(true);
    setPrepError("");
    setPrepSaved(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prepTimeMinutes: draftPrep }),
      });
      const data = await res.json();

      if (!res.ok) {
        setPrepError(data.message || tr("settings.errorSave"));
        return;
      }

      const next: number = data.data.prepTimeMinutes;
      setPrepMinutes(next);
      const split = splitPrepTime(next);
      setPrepHours(String(split.hours));
      setPrepMins(String(split.minutes));
      setPrepSaved(true);

      // Ο νέος χρόνος επηρεάζει τον έλεγχο διαθεσιμότητας στις Κρατήσεις,
      // που σερβίρεται από το router cache.
      router.refresh();
    } catch {
      setPrepError(tr("settings.errorConnection"));
    } finally {
      setSavingPrep(false);
    }
  };

  const changeMode = async (next: RentalMode) => {
    if (next === rentalMode || saving) return;

    setSaving(next);
    setError("");
    setSaved(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rentalMode: next }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("settings.errorSave"));
        return;
      }

      setRentalMode(data.data.rentalMode);
      setSaved(true);

      // Καθαρίζει το router cache: αλλιώς η σελίδα Κρατήσεων θα συνέχιζε να
      // σερβίρεται από την cache και θα έδειχνε τον παλιό τρόπο λειτουργίας.
      router.refresh();
    } catch {
      setError(tr("settings.errorConnection"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("settings.title")}</h1>
        <p className="dash-page-sub">
          {companyName} · {tr("settings.subtitle")}
        </p>
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{tr("settings.rentalMode")}</h2>
        <p className="dash-form-note dash-settings-lead">
          {tr("settings.rentalModeHelp")}
        </p>

        <div className="dash-modes">
          {RENTAL_MODES.map((mode) => {
            const Icon = MODE_ICON[mode];
            const active = rentalMode === mode;
            return (
              <button
                key={mode}
                className={`dash-mode ${active ? "active" : ""}`}
                onClick={() => changeMode(mode)}
                disabled={Boolean(saving)}
                aria-pressed={active}
              >
                <span className="dash-mode-icon">
                  <Icon size={20} />
                </span>
                <span className="dash-mode-text">
                  <span className="dash-mode-name">
                    {tr(`rentalMode.${mode}`)}
                  </span>
                  <span className="dash-mode-desc">
                    {tr(`settings.rentalMode${mode}Help`)}
                  </span>
                </span>
                {active && (
                  <span className="dash-mode-check">
                    <Check size={16} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {error && <div className="dash-form-error">{error}</div>}
        {saved && !error && (
          <div className="dash-alert-ok dash-settings-saved">
            <Check size={16} /> {tr("settings.saved")}
          </div>
        )}
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">
          <Timer size={17} /> {tr("settings.prepTime")}
        </h2>
        <p className="dash-form-note dash-settings-lead">
          {tr("settings.prepTimeHelp")}
        </p>

        <div className="dash-prep-row">
          <label className="dash-field dash-field--xs">
            {tr("settings.prepTimeHours")}
            <input
              type="number"
              min={0}
              max={Math.floor(MAX_PREP_MINUTES / 60)}
              inputMode="numeric"
              value={prepHours}
              onChange={(e) => {
                setPrepHours(e.target.value);
                setPrepSaved(false);
              }}
            />
          </label>
          <label className="dash-field dash-field--xs">
            {tr("settings.prepTimeMinutes")}
            <input
              type="number"
              min={0}
              max={59}
              step={5}
              inputMode="numeric"
              value={prepMins}
              onChange={(e) => {
                setPrepMins(e.target.value);
                setPrepSaved(false);
              }}
            />
          </label>
          <button
            className="dash-btn dash-btn--primary dash-prep-save"
            onClick={savePrepTime}
            disabled={savingPrep || !prepDirty}
          >
            {savingPrep ? tr("bookings.saving") : tr("settings.prepTimeSave")}
          </button>
        </div>

        <p className="dash-form-note">
          {tr("settings.prepTimeCurrent")}:{" "}
          <strong>
            {prepMinutes === 0
              ? tr("settings.prepTimeNone")
              : formatPrepTime(prepMinutes, locale)}
          </strong>
        </p>

        {prepError && <div className="dash-form-error">{prepError}</div>}
        {prepSaved && !prepError && (
          <div className="dash-alert-ok dash-settings-saved">
            <Check size={16} /> {tr("settings.saved")}
          </div>
        )}
      </div>
    </>
  );
}
