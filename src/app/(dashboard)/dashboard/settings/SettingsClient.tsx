"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Inbox, Check } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";

const RENTAL_MODES = ["BOOKING", "REQUEST"] as const;
type RentalMode = (typeof RENTAL_MODES)[number];

const MODE_ICON = {
  BOOKING: CalendarCheck,
  REQUEST: Inbox,
} as const;

export default function SettingsClient({
  companyName,
  initialRentalMode,
}: {
  companyName: string;
  initialRentalMode: string;
}) {
  const tr = useT();
  const router = useRouter();

  const [rentalMode, setRentalMode] = useState<string>(initialRentalMode);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

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
    </>
  );
}
