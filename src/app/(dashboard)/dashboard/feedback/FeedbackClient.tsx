"use client";

// «Πες μας τη γνώμη σου»: 3 ερωτήσεις, όλες προαιρετικές (τουλάχιστον μία).
// Η 3η στέλνεται ως ΑΡΙΘΜΟΣ (οχήματα) — για να φαίνεται αν τα όρια ταιριάζουν.

import { useState } from "react";
import { useT } from "@/lib/i18n/I18nProvider";

export default function FeedbackClient() {
  const tr = useT();
  const [helpedMost, setHelpedMost] = useState("");
  const [missing, setMissing] = useState("");
  const [vehicles, setVehicles] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = vehicles.trim() === "" ? null : Number(vehicles);
    if (!helpedMost.trim() && !missing.trim() && n === null) {
      setError(tr("feedback.empty"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ helpedMost, missing, vehicleCount: n !== null && Number.isInteger(n) && n >= 0 ? n : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("feedback.error"));
        return;
      }
      setDone(true);
    } catch {
      setError(tr("feedback.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("feedback.title")}</h1>
        <p className="dash-page-sub">{tr("feedback.subtitle")}</p>
      </div>
      <div className="dash-panel dash-settings-panel" data-testid="feedback-page">
        {done ? (
          <p className="dash-form-note" role="status">{tr("feedback.thanks")}</p>
        ) : (
          <form className="dash-form-grid" onSubmit={submit} noValidate>
            <label className="dash-field dash-field--wide">
              {tr("feedback.q1")}
              <textarea rows={3} maxLength={2000} value={helpedMost} onChange={(e) => setHelpedMost(e.target.value)} />
            </label>
            <label className="dash-field dash-field--wide">
              {tr("feedback.q2")}
              <textarea rows={3} maxLength={2000} value={missing} onChange={(e) => setMissing(e.target.value)} />
            </label>
            <label className="dash-field">
              {tr("feedback.q3")}
              <input type="number" min={0} max={100000} step={1} inputMode="numeric" value={vehicles} onChange={(e) => setVehicles(e.target.value)} />
            </label>
            {error && <p className="dash-form-error dash-field--wide" role="alert">{error}</p>}
            <div className="dash-field--wide">
              <button className="dash-btn dash-btn--primary" type="submit" disabled={busy}>
                {busy ? tr("feedback.sending") : tr("feedback.submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
