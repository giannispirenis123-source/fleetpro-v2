"use client";

// src/app/(auth)/forgot-password/ForgotClient.tsx
// Φόρμα «στείλε μου σύνδεσμο». Το μήνυμα επιτυχίας έρχεται από τον server και
// είναι ΙΔΙΟ για κάθε email (δεν φαίνεται αν υπάρχει λογαριασμός).

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { SignupLang } from "@/lib/signup/signup";

export default function ForgotClient({ initialLang }: { initialLang: SignupLang }) {
  const [lang, setLang] = useState<SignupLang>(initialLang);
  const tr = (k: string) => t(`reset.${k}`, lang);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSent("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.message || tr("errorConnection"));
      else setSent(data.message);
    } catch {
      setError(tr("errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signup-root">
      <div className="signup-card">
        <div className="signup-top">
          <a className="signup-brand" href="/login">Kratisi</a>
          <div className="signup-lang" role="group" aria-label={t("common.language", lang)}>
            {(["el", "en"] as const).map((l) => (
              <button key={l} type="button" className={lang === l ? "active" : ""} aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l === "el" ? "ΕΛ" : "EN"}
              </button>
            ))}
          </div>
        </div>

        <h1>{tr("forgotTitle")}</h1>
        <p className="signup-sub">{tr("forgotText")}</p>
        <form className="signup-form" onSubmit={submit}>
          <label className="signup-label">
            {tr("email")}
            <input className="signup-input" type="email" name="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" required data-testid="forgot-email" />
          </label>
          {error && <div className="signup-error" role="alert" data-testid="forgot-error">{error}</div>}
          {sent && <div className="signup-ok" role="status" data-testid="forgot-sent">{sent}</div>}
          <button className="signup-btn" type="submit" disabled={busy || !email.trim()} data-testid="forgot-submit">
            {busy ? tr("sending") : tr("sendLink")}
          </button>
        </form>
        <p className="signup-foot">
          <a href="/login">{tr("backToLogin")}</a>
        </p>
      </div>
    </div>
  );
}
