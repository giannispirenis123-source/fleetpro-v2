// src/app/(auth)/legal/LegalPlaceholder.tsx
// Όροι/απόρρητο της ΠΛΑΤΦΟΡΜΑΣ — ΠΡΟΣΩΡΙΝΟ κείμενο, σημαδεμένο καθαρά ως τέτοιο.

import { t } from "@/lib/i18n";
import { signupLang } from "@/lib/signup/signup";
import "../auth-pages.css";

export default function LegalPlaceholder({ kind, lang: rawLang }: { kind: "terms" | "privacy"; lang?: string }) {
  const lang = signupLang(rawLang);
  const tr = (k: string) => t(`legal.${k}`, lang);
  return (
    <div className="signup-root">
      <article className="signup-card signup-card--wide" lang={lang}>
        <div className="signup-top">
          <a className="signup-brand" href="/login">FleetPro</a>
          <div className="signup-lang">
            <a className="signup-link" href={`?lang=${lang === "el" ? "en" : "el"}`}>{lang === "el" ? "EN" : "ΕΛ"}</a>
          </div>
        </div>
        <div className="legal-draft" role="note" data-testid="legal-draft">{tr("draftBanner")}</div>
        <h1>{tr(kind === "terms" ? "termsTitle" : "privacyTitle")}</h1>
        <p className="legal-body">{tr(kind === "terms" ? "termsBody" : "privacyBody")}</p>
        <p className="signup-foot">
          <a href="/login">{tr("back")}</a>
        </p>
      </article>
    </div>
  );
}
