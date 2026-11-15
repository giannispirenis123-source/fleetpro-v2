"use client";

// src/app/(auth)/reset-password/ResetClient.tsx
// Νέος κωδικός (δύο φορές). Μετά την επιτυχία: σύνδεσμος για σύνδεση — καμία
// αυτόματη σύνδεση. Οι κωδικοί καθαρίζουν από τη μνήμη της σελίδας αμέσως.

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { SignupLang } from "@/lib/signup/signup";

export default function ResetClient({ token, initialLang }: { token: string | null; initialLang: SignupLang }) {
  const [lang, setLang] = useState<SignupLang>(initialLang);
  const tr = (k: string) => t(`reset.${k}`, lang);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  // Ο server απέρριψε τον ΣΥΝΔΕΣΜΟ (άκυρος/ληγμένος/χρησιμοποιημένος) → «ζητήστε νέο».
  const [linkBad, setLinkBad] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) return setError(tr("weak"));
    if (password !== confirm) return setError(tr("mismatch"));
    setBusy(true);
    setError("");
    setLinkBad(false);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("errorConnection"));
        setLinkBad(data.code === "token");
      } else {
        setDone(data.message);
        setPassword("");
        setConfirm("");
      }
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

        <h1>{tr("resetTitle")}</h1>
        {done ? (
          <>
            <div className="signup-ok" role="status" data-testid="reset-done">{done}</div>
            <p className="signup-foot">
              <a href="/login" data-testid="reset-login">{tr("backToLogin")}</a>
            </p>
          </>
        ) : !token ? (
          <>
            <p className="signup-sub" data-testid="reset-no-token">{tr("noToken")}</p>
            <p className="signup-foot">
              <a href={`/forgot-password?lang=${lang}`}>{tr("requestNew")}</a>
            </p>
          </>
        ) : (
          <>
            <p className="signup-sub">{tr("resetText")}</p>
            <form className="signup-form" onSubmit={submit}>
              <label className="signup-label">
                {tr("newPassword")}
                <input className="signup-input" type="password" name="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={200} autoComplete="new-password" required data-testid="reset-password" />
              </label>
              <label className="signup-label">
                {tr("confirmPassword")}
                <input className="signup-input" type="password" name="confirm-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} maxLength={200} autoComplete="new-password" required data-testid="reset-confirm" />
              </label>
              {error && (
                <div className="signup-error" role="alert" data-testid="reset-error">
                  {error} {linkBad && <a href={`/forgot-password?lang=${lang}`}>{tr("requestNew")}</a>}
                </div>
              )}
              <button className="signup-btn" type="submit" disabled={busy} data-testid="reset-submit">
                {busy ? tr("saving") : tr("save")}
              </button>
            </form>
            <p className="signup-foot">
              <a href="/login">{tr("backToLogin")}</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
