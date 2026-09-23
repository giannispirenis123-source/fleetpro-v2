"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  Inbox,
  Check,
  Timer,
  ArrowUp,
  Percent,
  Receipt,
  Send,
} from "lucide-react";
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

const ISSUE_TRIGGERS = ["ON_COMPLETION", "ON_CONTRACT"] as const;
const SEND_MODES = ["MANUAL", "AUTO"] as const;

/** Η έκδοση με το συμβόλαιο αποθηκεύεται, αλλά δεν ενεργεί ακόμα. */
const TRIGGER_SOON: Record<string, boolean> = {
  ON_COMPLETION: false,
  ON_CONTRACT: true,
};

export default function SettingsClient({
  companyName,
  initialRentalMode,
  initialPrepMinutes,
  initialRoundUp,
  initialVatRate,
  initialIssueTrigger,
  initialSendMode,
}: {
  companyName: string;
  initialRentalMode: string;
  initialPrepMinutes: number;
  initialRoundUp: boolean;
  initialVatRate: number;
  initialIssueTrigger: string;
  initialSendMode: string;
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

  const [roundUp, setRoundUp] = useState(initialRoundUp);
  const [savingRound, setSavingRound] = useState(false);
  const [roundSaved, setRoundSaved] = useState(false);
  const [roundError, setRoundError] = useState("");

  /* ── Τιμολόγηση ── */
  const [vatRate, setVatRate] = useState(initialVatRate);
  const [vatDraft, setVatDraft] = useState(String(initialVatRate));
  const [savingVat, setSavingVat] = useState(false);
  const [vatSaved, setVatSaved] = useState(false);
  const [vatError, setVatError] = useState("");

  const [issueTrigger, setIssueTrigger] = useState<string>(initialIssueTrigger);
  const [sendMode, setSendMode] = useState<string>(initialSendMode);
  const [savingInvoice, setSavingInvoice] = useState<string | null>(null);
  const [invoiceSaved, setInvoiceSaved] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");

  const vatDirty =
    vatDraft.trim() !== "" &&
    Number(vatDraft) >= 0 &&
    Number(vatDraft) <= 100 &&
    Number(vatDraft) !== vatRate;

  const saveVat = async () => {
    if (savingVat || !vatDirty) return;

    setSavingVat(true);
    setVatError("");
    setVatSaved(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vatRate: Number(vatDraft) }),
      });
      const data = await res.json();

      if (!res.ok) {
        setVatError(data.message || tr("settings.errorSave"));
        return;
      }

      const next = Number(data.data.vatRate);
      setVatRate(next);
      setVatDraft(String(next));
      setVatSaved(true);

      // Το νέο ποσοστό αφορά τα ΕΠΟΜΕΝΑ τιμολόγια· τα ήδη εκδομένα
      // κρατούν το δικό τους. Η ανανέωση καθαρίζει το router cache.
      router.refresh();
    } catch {
      setVatError(tr("settings.errorConnection"));
    } finally {
      setSavingVat(false);
    }
  };

  const saveInvoiceSetting = async (
    field: "invoiceIssueTrigger" | "invoiceSendMode",
    value: string
  ) => {
    if (savingInvoice) return;

    setSavingInvoice(value);
    setInvoiceError("");
    setInvoiceSaved(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();

      if (!res.ok) {
        setInvoiceError(data.message || tr("settings.errorSave"));
        return;
      }

      setIssueTrigger(data.data.invoiceIssueTrigger);
      setSendMode(data.data.invoiceSendMode);
      setInvoiceSaved(true);
      router.refresh();
    } catch {
      setInvoiceError(tr("settings.errorConnection"));
    } finally {
      setSavingInvoice(null);
    }
  };

  const toggleRoundUp = async (next: boolean) => {
    if (savingRound || next === roundUp) return;

    setSavingRound(true);
    setRoundError("");
    setRoundSaved(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundUpTotal: next }),
      });
      const data = await res.json();

      if (!res.ok) {
        setRoundError(data.message || tr("settings.errorSave"));
        return;
      }

      setRoundUp(data.data.roundUpTotal);
      setRoundSaved(true);

      // Η ρύθμιση αλλάζει την προεπισκόπηση τιμής στις Κρατήσεις, που
      // σερβίρεται από το router cache.
      router.refresh();
    } catch {
      setRoundError(tr("settings.errorConnection"));
    } finally {
      setSavingRound(false);
    }
  };

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

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">
          <ArrowUp size={17} /> {tr("settings.roundUp")}
        </h2>
        <p className="dash-form-note dash-settings-lead">
          {tr("settings.roundUpHelp")}
        </p>

        <label className="dash-switch">
          <input
            type="checkbox"
            checked={roundUp}
            onChange={(e) => toggleRoundUp(e.target.checked)}
            disabled={savingRound}
          />
          <span className="dash-switch-text">
            <span className="dash-switch-name">
              {roundUp ? tr("settings.roundUpOn") : tr("settings.roundUpOff")}
            </span>
            <span className="dash-switch-desc">
              {roundUp
                ? tr("settings.roundUpOnDesc")
                : tr("settings.roundUpOffDesc")}
            </span>
          </span>
        </label>

        {roundError && <div className="dash-form-error">{roundError}</div>}
        {roundSaved && !roundError && (
          <div className="dash-alert-ok dash-settings-saved">
            <Check size={16} /> {tr("settings.saved")}
          </div>
        )}
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">
          <Percent size={17} /> {tr("settings.vat")}
        </h2>
        <p className="dash-form-note dash-settings-lead">
          {tr("settings.vatHelp")}
        </p>

        <div className="dash-prep-row">
          <label className="dash-field dash-field--xs">
            {tr("settings.vatRate")}
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              inputMode="decimal"
              value={vatDraft}
              onChange={(e) => {
                setVatDraft(e.target.value);
                setVatSaved(false);
              }}
            />
          </label>
          <button
            className="dash-btn dash-btn--primary dash-prep-save"
            onClick={saveVat}
            disabled={savingVat || !vatDirty}
          >
            {savingVat ? tr("bookings.saving") : tr("settings.prepTimeSave")}
          </button>
        </div>

        <p className="dash-form-note">
          {tr("settings.vatCurrent")}: <strong>{vatRate}%</strong>
        </p>

        {vatError && <div className="dash-form-error">{vatError}</div>}
        {vatSaved && !vatError && (
          <div className="dash-alert-ok dash-settings-saved">
            <Check size={16} /> {tr("settings.saved")}
          </div>
        )}
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">
          <Receipt size={17} /> {tr("settings.invoiceTrigger")}
        </h2>
        <p className="dash-form-note dash-settings-lead">
          {tr("settings.invoiceTriggerHelp")}
        </p>

        <div className="dash-modes">
          {ISSUE_TRIGGERS.map((value) => {
            const active = issueTrigger === value;
            return (
              <button
                key={value}
                className={`dash-mode ${active ? "active" : ""}`}
                onClick={() => saveInvoiceSetting("invoiceIssueTrigger", value)}
                disabled={Boolean(savingInvoice)}
                aria-pressed={active}
              >
                <span className="dash-mode-icon">
                  <Receipt size={20} />
                </span>
                <span className="dash-mode-text">
                  <span className="dash-mode-name">
                    {tr(`settings.trigger${value}`)}
                    {TRIGGER_SOON[value] && (
                      <span className="dash-soon">
                        {tr("common.comingSoon")}
                      </span>
                    )}
                  </span>
                  <span className="dash-mode-desc">
                    {tr(`settings.trigger${value}Help`)}
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

        <h2 className="dash-section-title dash-settings-second">
          <Send size={17} /> {tr("settings.invoiceSend")}
        </h2>
        <p className="dash-form-note dash-settings-lead">
          {tr("settings.invoiceSendHelp")}
        </p>

        <div className="dash-modes">
          {SEND_MODES.map((value) => {
            const active = sendMode === value;
            return (
              <button
                key={value}
                className={`dash-mode ${active ? "active" : ""}`}
                onClick={() => saveInvoiceSetting("invoiceSendMode", value)}
                disabled={Boolean(savingInvoice)}
                aria-pressed={active}
              >
                <span className="dash-mode-icon">
                  <Send size={20} />
                </span>
                <span className="dash-mode-text">
                  <span className="dash-mode-name">
                    {tr(`settings.send${value}`)}
                  </span>
                  <span className="dash-mode-desc">
                    {tr(`settings.send${value}Help`)}
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

        <p className="dash-form-note">{tr("settings.invoiceEmailSoon")}</p>

        {invoiceError && <div className="dash-form-error">{invoiceError}</div>}
        {invoiceSaved && !invoiceError && (
          <div className="dash-alert-ok dash-settings-saved">
            <Check size={16} /> {tr("settings.saved")}
          </div>
        )}
      </div>
    </>
  );
}
