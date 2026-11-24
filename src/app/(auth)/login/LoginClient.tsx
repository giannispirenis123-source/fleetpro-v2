// src/app/(auth)/login/LoginClient.tsx
// Ενιαία σελίδα σύνδεσης για όλους τους ρόλους (το page.tsx περνά τον
// διακόπτη της αυτόματης εγγραφής, που ζει μόνο στον server).

"use client";

import { SUPPORT_EMAIL } from "@/lib/supportEmail";
import SupportEmailCopy, { SUPPORT_EMAIL_STYLES } from "@/components/SupportEmailCopy";
import { useState } from "react";
import { Eye, EyeOff, Zap, Car } from "lucide-react";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";

export default function LoginClient({
  signupEnabled,
  callbackUrl = null,
  initialLocale = DEFAULT_LOCALE,
}: {
  signupEnabled: boolean;
  /** Από το ?callbackUrl= — ο SERVER αποφασίζει αν είναι ασφαλές (loginRedirectFor). */
  callbackUrl?: string | null;
  /** Από το ?lang= (π.χ. από το αγγλικό site μιας εταιρίας). */
  initialLocale?: Locale;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Σωστός κωδικός αλλά email που περιμένει επαλήθευση (μόνο από /signup).
  const [unverified, setUnverified] = useState(false);

  // Στη σελίδα σύνδεσης δεν υπάρχει ακόμη χρήστης, άρα η γλώσσα είναι
  // απλή τοπική επιλογή της φόρμας — δεν αποθηκεύεται πουθενά.
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const tr = (key: string) => t(key, locale);

  const handleLogin = async () => {
    if (!email || !password) {
      setError(tr("auth.errorMissingFields"));
      return;
    }

    setLoading(true);
    setError("");
    setUnverified(false);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(callbackUrl ? { email, password, callbackUrl } : { email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("auth.errorDefault"));
        setUnverified(data.code === "unverified");
        return;
      }

      window.location.href = data.data.redirectTo;
    } catch {
      setError(tr("auth.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-root">
      {/* Left Panel */}
      <div className="login-left">
        <div className="login-brand">
          <div className="login-logo">
            <Zap size={24} />
          </div>
          <span>Kratisi</span>
        </div>

        <div className="login-hero">
          <h1>
            {tr("auth.heroTitleLine1")}
            <br />
            <span className="login-accent">{tr("auth.heroTitleLine2")}</span>
          </h1>
          <p>{tr("auth.heroSubtitle")}</p>
        </div>

        <div className="login-features">
          {["feature1", "feature2", "feature3", "feature4"].map((key) => (
            <div key={key} className="login-feature">
              <span className="login-dot" />
              {tr(`auth.${key}`)}
            </div>
          ))}
        </div>

        <div className="login-cars">
          <Car size={120} strokeWidth={0.5} className="login-car-icon" />
        </div>
      </div>

      {/* Right Panel */}
      <div className="login-right">
        <div className="login-form-wrap">
          <div className="login-lang" role="group" aria-label={tr("common.language")}>
            <button
              type="button"
              className={`login-lang-btn ${locale === "el" ? "active" : ""}`}
              onClick={() => setLocale("el")}
              aria-pressed={locale === "el"}
            >
              ΕΛ
            </button>
            <button
              type="button"
              className={`login-lang-btn ${locale === "en" ? "active" : ""}`}
              onClick={() => setLocale("en")}
              aria-pressed={locale === "en"}
            >
              EN
            </button>
          </div>

          <div className="login-form-header">
            <h2>{tr("auth.welcome")}</h2>
            <p>{tr("auth.signInPrompt")}</p>
          </div>

          <div className="login-form">
            <label className="login-label">
              {tr("auth.email")}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder={tr("auth.emailPlaceholder")}
                className="login-input"
                autoFocus
              />
            </label>

            <label className="login-label">
              {tr("auth.password")}
              <div className="login-password-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="••••••••"
                  className="login-input"
                />
                <button
                  type="button"
                  className="login-eye"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={
                    showPassword ? tr("auth.hidePassword") : tr("auth.showPassword")
                  }
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <a className="login-forgot" href={`/forgot-password?lang=${locale}`} data-testid="login-forgot">
              {tr("reset.loginLink")}
            </a>

            {error && (
              <div className="login-error">
                {error}
                {unverified && signupEnabled && (
                  <>
                    {" "}
                    <a href={`/verify-email?lang=${locale}`}>{tr("signup.unverifiedLogin")}</a>
                  </>
                )}
              </div>
            )}

            <button
              className="login-btn"
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <span className="login-spinner" />
              ) : (
                tr("auth.signIn")
              )}
            </button>
          </div>

          {/* Δύο ΑΝΕΞΑΡΤΗΤΑ μπλοκ: δημιουργία λογαριασμού (μόνο με ανοιχτή εγγραφή,
              SELF_SIGNUP_ENABLED) και βοήθεια (μόνο με NEXT_PUBLIC_SUPPORT_EMAIL).
              Λείπουν και τα δύο → τίποτα. */}
          {signupEnabled && (
            <div className="login-signup" data-testid="login-signup">
              <div className="login-or" role="separator" aria-label={tr("auth.orDivider")}>
                <span aria-hidden="true">{tr("auth.orDivider")}</span>
              </div>
              <a className="login-btn-secondary" href={`/signup?lang=${locale}`} data-testid="login-create-account">
                {tr("auth.createAccount")}
              </a>
              <p className="login-signup-sub">{tr("auth.createAccountHint")}</p>
            </div>
          )}

          {SUPPORT_EMAIL && (
            <div className="login-help" data-testid="login-support">
              <p className="login-help-text">
                {tr("auth.needHelp")}{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} data-testid="login-contact">{tr("auth.contactUs")}</a>
              </p>
              {/* Η διεύθυνση ΚΑΙ ως ορατό κείμενο: χωρίς πρόγραμμα email το mailto δεν κάνει τίποτα. */}
              <SupportEmailCopy
                email={SUPPORT_EMAIL}
                labels={{ copy: tr("auth.copyEmail"), copied: tr("auth.emailCopied") }}
                testIdPrefix="login-support"
              />
            </div>
          )}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: loginStyles + SUPPORT_EMAIL_STYLES }} />
    </div>
  );
}

const loginStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .login-root {
    min-height: 100vh;
    display: flex;
    font-family: 'Inter', sans-serif;
    background: var(--bg);
  }

  /* Left */
  .login-left {
    width: 480px;
    min-height: 100vh;
    background: linear-gradient(135deg, var(--surface) 0%, var(--violet-bg) 100%);
    padding: 40px;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
  }

  .login-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    font-weight: 800;
    color: var(--text);
  }

  .login-logo {
    width: 40px; height: 40px;
    background: var(--primary);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    color: #fff;
  }

  .login-hero {
    margin-top: auto;
  }

  .login-hero h1 {
    font-size: 40px;
    font-weight: 800;
    color: var(--text);
    line-height: 1.15;
    margin-bottom: 16px;
  }

  .login-accent {
    background: linear-gradient(135deg, var(--primary-soft), var(--violet-fg));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .login-hero p {
    font-size: 14px;
    color: var(--text-4);
    line-height: 1.6;
    max-width: 340px;
  }

  .login-features {
    margin-top: 32px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: auto;
  }

  .login-feature {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text-3);
  }

  .login-dot {
    width: 6px; height: 6px;
    background: var(--primary);
    border-radius: 50%;
    flex-shrink: 0;
  }

  .login-cars {
    position: absolute;
    bottom: -20px;
    right: -20px;
    opacity: 0.06;
    color: var(--text);
    pointer-events: none;
  }

  /* Right */
  .login-right {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    background: var(--bg);
  }

  .login-lang {
    display: flex;
    gap: 4px;
    align-self: flex-end;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 3px;
    margin-bottom: 18px;
  }
  .login-lang-btn {
    background: none;
    border: none;
    color: var(--text-4);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 5px 11px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .login-lang-btn:hover { color: var(--text); }
  .login-lang-btn.active {
    background: var(--primary);
    color: #fff;
  }

  .login-form-wrap {
    width: 100%;
    max-width: 380px;
  }

  .login-form-header {
    margin-bottom: 32px;
  }

  .login-form-header h2 {
    font-size: 26px;
    font-weight: 800;
    color: var(--text);
    margin-bottom: 6px;
  }

  .login-form-header p {
    font-size: 13px;
    color: var(--text-4);
  }

  .login-form { display: flex; flex-direction: column; gap: 16px; }

  .login-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-4);
  }

  .login-input {
    background: var(--surface);
    border: 1px solid var(--hover-2);
    border-radius: 10px;
    padding: 12px 14px;
    color: var(--text);
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
    font-family: inherit;
    width: 100%;
  }
  .login-input:focus { border-color: var(--primary); }
  .login-input::placeholder { color: var(--placeholder); }

  .login-password-wrap { position: relative; }
  .login-password-wrap .login-input { padding-right: 44px; }
  .login-eye {
    position: absolute;
    right: 12px; top: 50%;
    transform: translateY(-50%);
    background: none; border: none;
    color: var(--text-4); cursor: pointer;
    display: flex; align-items: center;
    transition: color 0.1s;
  }
  .login-eye:hover { color: var(--text-3); }

  .login-forgot { align-self: flex-end; margin-top: -4px; font-size: 12px; color: var(--primary-soft, #818cf8); text-decoration: none; }
  .login-forgot:hover { text-decoration: underline; }
  .login-error a { color: inherit; font-weight: 600; }
  .login-error {
    background: var(--bad-bg);
    border: 1px solid var(--bad-border);
    border-radius: 8px;
    padding: 10px 12px;
    color: var(--bad-fg);
    font-size: 12px;
  }

  .login-btn {
    background: var(--primary);
    color: #fff;
    border: none;
    border-radius: 10px;
    padding: 13px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 46px;
    margin-top: 4px;
  }
  .login-btn:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
  .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .login-spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Δημιουργία λογαριασμού: δευτερεύον κουμπί, ίδιο ύψος με το «Σύνδεση» ── */
  .login-signup { margin-top: 18px; display: flex; flex-direction: column; gap: 12px; }
  .login-or {
    display: flex; align-items: center; gap: 12px;
    font-size: 12px; color: var(--text-4); text-transform: lowercase;
  }
  .login-or::before, .login-or::after { content: ""; flex: 1; height: 1px; background: var(--border); }
  .login-btn-secondary {
    display: flex; align-items: center; justify-content: center;
    min-height: 46px; padding: 12px; border-radius: 10px; box-sizing: border-box; width: 100%;
    border: 1.5px solid var(--primary); background: var(--surface); color: var(--primary-soft);
    font-size: 14px; font-weight: 700; text-decoration: none;
    transition: background 0.15s, border-color 0.15s, transform 0.15s;
  }
  .login-btn-secondary:hover { background: var(--primary-bg); border-color: var(--primary-hover); transform: translateY(-1px); }
  .login-signup-sub { margin: -4px 0 0; text-align: center; font-size: 12px; color: var(--text-4); }

  /* ── Βοήθεια: διακριτικό, μικρότερο, πιο απαλό ── */
  .login-help {
    margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--border);
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    font-size: 12px; color: var(--text-4); text-align: center;
  }
  .login-help-text { margin: 0; }
  .login-help a { color: var(--primary-soft); text-decoration: none; }
  .login-help a:hover { text-decoration: underline; }
  .login-help .support-email-addr { font-weight: 600; }

  /* Πληκτρολόγιο: ορατό focus σε κουμπιά και συνδέσμους */
  .login-btn:focus-visible, .login-btn-secondary:focus-visible,
  .login-help a:focus-visible, .login-forgot:focus-visible {
    outline: 2px solid var(--primary); outline-offset: 2px;
  }

  @media (max-width: 900px) {
    .login-left { display: none; }
  }
`;
