"use client";

// src/app/(auth)/verify-email/VerifyClient.tsx
// «Επιβεβαίωση και συνέχεια» → αυτόματη σύνδεση και onboarding.
// «Ξαναστείλε email» → ουδέτερη απάντηση (όριο ανά IP/email στον server).

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { SignupLang } from "@/lib/signup/signup";

export default function VerifyClient({ token, initialLang }: { token: string | null; initialLang: SignupLang }) {
  const [lang, setLang] = useState<SignupLang>(initialLang);
  const tr = (k: string) => t(`signup.${k}`, lang);
  const [busy, setBusy] = useState<"" | "verify" | "resend">("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [resendMsg, setResendMsg] = useState("");
  const [resendErr, setResendErr] = useState("");

  const verify = async () => {
    setBusy("verify");
    setError("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("errorConnection"));
        return;
      }
      window.location.href = data.data.redirectTo;
    } catch {
      setError(tr("errorConnection"));
    } finally {
      setBusy("");
    }
  };

  const resend = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("resend");
    setResendMsg("");
    setResendErr("");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setResendErr(data.message || tr("errorConnection"));
      else setResendMsg(data.message);
    } catch {
      setResendErr(tr("errorConnection"));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="signup-root">
      <div className="signup-card">
        <div className="signup-top">
          <a className="signup-brand" href="/login">FleetPro</a>
          <div className="signup-lang" role="group" aria-label={t("common.language", lang)}>
            {(["el", "en"] as const).map((l) => (
              <button key={l} type="button" className={lang === l ? "active" : ""} aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l === "el" ? "ΕΛ" : "EN"}
              </button>
            ))}
          </div>
        </div>

        <h1>{tr("verifyTitle")}</h1>
        {token ? (
          <>
            <p className="signup-sub">{tr("verifyText")}</p>
            {error && <div className="signup-error" role="alert" data-testid="verify-error">{error}</div>}
            <button className="signup-btn" style={{ width: "100%", marginTop: 12 }} onClick={verify} disabled={busy !== ""}>
              {busy === "verify" ? tr("verifying") : tr("verifyButton")}
            </button>
          </>
        ) : (
          <p className="signup-sub">{tr("noToken")}</p>
        )}

        <hr className="signup-sep" />
        <h2 className="signup-h2">{tr("resendTitle")}</h2>
        <p className="signup-sub">{tr("resendHint")}</p>
        <form className="signup-form" onSubmit={resend}>
          <label className="signup-label">
            {tr("email")}
            <input className="signup-input" type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" required />
          </label>
          {resendErr && <div className="signup-error" role="alert">{resendErr}</div>}
          {resendMsg && <div className="signup-ok" role="status" data-testid="resend-sent">{resendMsg}</div>}
          <button className="signup-btn signup-btn--ghost" type="submit" disabled={busy !== "" || !email.trim()}>
            {tr("resend")}
          </button>
        </form>
        <p className="signup-foot">
          <a href="/login">{tr("signIn")}</a>
        </p>
      </div>
    </div>
  );
}
