"use client";

// src/app/(auth)/signup/SignupClient.tsx
// Φόρμα εγγραφής. Ο server αποφασίζει τα πάντα (ρόλος, εταιρία, slug)· από
// εδώ φεύγουν μόνο τα πεδία της φόρμας. Μετά την υποβολή: ΙΔΙΟ μήνυμα σε κάθε
// περίπτωση (καμία αποκάλυψη αν το email υπάρχει).

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import type { SignupLang } from "@/lib/signup/signup";

export default function SignupClient({ initialLang, billing = false }: { initialLang: SignupLang; billing?: boolean }) {
  const [lang, setLang] = useState<SignupLang>(initialLang);
  const tr = (k: string) => t(`signup.${k}`, lang);
  const [form, setForm] = useState({ companyName: "", ownerName: "", email: "", password: "", website: "", founderCode: "" });
  // Πρόγραμμα πρώτων εταιριών: ΜΟΝΟ ο αριθμός θέσεων από το δημόσιο endpoint.
  const [spots, setSpots] = useState<number | null>(null);

  useEffect(() => {
    if (!billing) return;
    let alive = true;
    fetch("/api/public/founding-spots", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.remaining === "number") setSpots(d.remaining);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [billing]);
  const [accept, setAccept] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyName.trim() || !form.ownerName.trim() || !form.email.trim() || form.password.length < 8 || !accept) {
      setError(tr("errorFields"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, founderCode: spots && spots > 0 ? form.founderCode : "", acceptTerms: accept, lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("errorConnection"));
        return;
      }
      setSent(data.message);
    } catch {
      setError(tr("errorConnection"));
    } finally {
      setLoading(false);
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

        {sent ? (
          <>
            <h1>{tr("sentTitle")}</h1>
            <div className="signup-ok" role="status" data-testid="signup-sent">{sent}</div>
            <p className="signup-foot">
              <a href={`/verify-email?lang=${lang}`}>{tr("resendTitle")}</a>
            </p>
          </>
        ) : (
          <>
            <h1>{tr("title")}</h1>
            <p className="signup-sub">{tr("subtitle")}</p>
            {billing && spots !== null && (
              <div className={`signup-founder ${spots > 0 ? "" : "is-closed"}`} role="status" data-testid="founder-banner">
                {spots > 0 ? tr("founderBanner").replace("{n}", String(spots)) : tr("founderClosed")}
              </div>
            )}
            <form className="signup-form" onSubmit={submit} noValidate>
              <label className="signup-label">
                {tr("companyName")}
                <input className="signup-input" name="companyName" value={form.companyName} onChange={set("companyName")} maxLength={120} autoComplete="organization" required />
              </label>
              <label className="signup-label">
                {tr("ownerName")}
                <input className="signup-input" name="ownerName" value={form.ownerName} onChange={set("ownerName")} maxLength={120} autoComplete="name" required />
              </label>
              <label className="signup-label">
                {tr("email")}
                <input className="signup-input" name="email" type="email" value={form.email} onChange={set("email")} maxLength={254} autoComplete="email" required />
              </label>
              <label className="signup-label">
                {tr("password")}
                <input className="signup-input" name="password" type="password" value={form.password} onChange={set("password")} minLength={8} maxLength={200} autoComplete="new-password" required />
              </label>
              {billing && spots !== null && spots > 0 && (
                <label className="signup-label">
                  {tr("founderCode")}
                  <input className="signup-input" name="founderCode" value={form.founderCode} onChange={set("founderCode")} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
                  <span className="signup-hint">{tr("founderCodeHint")}</span>
                </label>
              )}
              {billing && !form.founderCode.trim() && <p className="signup-hint">{tr("trialNote")}</p>}
              {/* Honeypot — οι άνθρωποι δεν το βλέπουν ούτε το συμπληρώνουν. */}
              <div className="signup-hp" aria-hidden="true">
                <label>
                  Website
                  <input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
                </label>
              </div>
              <label className="signup-check">
                <input type="checkbox" name="acceptTerms" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                <span>
                  {tr("acceptPrefix")}{" "}
                  <a href={`/legal/terms?lang=${lang}`} target="_blank" rel="noopener">{tr("terms")}</a>{" "}
                  {tr("and")}{" "}
                  <a href={`/legal/privacy?lang=${lang}`} target="_blank" rel="noopener">{tr("privacy")}</a>
                </span>
              </label>
              {error && <div className="signup-error" role="alert">{error}</div>}
              <button className="signup-btn" type="submit" disabled={loading}>
                {loading ? "…" : tr("submit")}
              </button>
            </form>
            <p className="signup-foot">
              {tr("haveAccount")} <a href="/login">{tr("signIn")}</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
