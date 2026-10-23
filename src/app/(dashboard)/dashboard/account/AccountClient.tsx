"use client";

// «Ο λογαριασμός μου»: στοιχεία του χρήστη, γλώσσα, αποσύνδεση.

import { LogOut } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { LOCALES } from "@/lib/i18n/locale";
import { LOCALE_SHORT, ROLE_LABEL_KEY, initialsOf, useAccountActions } from "@/components/account/useAccountActions";

export default function AccountClient({
  name,
  email,
  role,
  companyName,
}: {
  name: string;
  email: string;
  role: string;
  companyName: string;
}) {
  const tr = useT();
  const { locale, changeLocale, savingLocale, logout } = useAccountActions();

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("account.title")}</h1>
        <p className="dash-page-sub">{tr("account.subtitle")}</p>
      </div>

      <div className="dash-panel dash-settings-panel dash-account-page" data-testid="account-page">
        <div className="dash-account-card">
          <span className="dash-user-avatar">{initialsOf(name) || "?"}</span>
          <dl className="dash-account-dl">
            <dt>{tr("account.name")}</dt>
            <dd>{name}</dd>
            <dt>{tr("account.email")}</dt>
            <dd>{email}</dd>
            <dt>{tr("account.role")}</dt>
            <dd>{ROLE_LABEL_KEY[role] ? tr(ROLE_LABEL_KEY[role]) : role}</dd>
            {companyName && (
              <>
                <dt>{tr("account.company")}</dt>
                <dd>{companyName}</dd>
              </>
            )}
          </dl>
        </div>

        <h2 className="dash-section-title">{tr("common.language")}</h2>
        <div className="dash-lang dash-lang--page" role="group" aria-label={tr("common.language")}>
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              className={`dash-lang-btn ${locale === code ? "active" : ""}`}
              onClick={() => changeLocale(code)}
              disabled={savingLocale}
              aria-pressed={locale === code}
            >
              {LOCALE_SHORT[code]} · {tr(code === "el" ? "common.greek" : "common.english")}
            </button>
          ))}
        </div>

        <button type="button" className="dash-btn dash-btn--danger dash-account-page-logout" onClick={logout}>
          <LogOut size={16} /> {tr("common.logout")}
        </button>
      </div>
    </>
  );
}
