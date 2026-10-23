"use client";

// src/components/account/AccountMenu.tsx
// Μενού λογαριασμού: avatar/όνομα που ανοίγει μικρό μενού με όνομα/email,
// «Ο λογαριασμός μου» (μόνο όπου υπάρχει σελίδα), γλώσσα και Αποσύνδεση.
// ΕΝΑ component για dashboard εταιρίας ΚΑΙ Super Admin. Στο desktop στην κορυφή
// του sidebar, στο κινητό στη σταθερή μπάρα (sticky) — πάντα ορατό.

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { LOCALES } from "@/lib/i18n/locale";
import { LOCALE_SHORT, ROLE_LABEL_KEY, initialsOf, useAccountActions } from "./useAccountActions";
import "./account-menu.css";

export default function AccountMenu({
  name,
  email,
  role,
  variant,
  onNavigate,
  accountHref = "/dashboard/account",
}: {
  name: string;
  email: string;
  role: string;
  /** "sidebar" (desktop) ή "topbar" (κινητό). */
  variant: "sidebar" | "topbar";
  onNavigate?: () => void;
  /** Η σελίδα «Ο λογαριασμός μου»· null = δεν υπάρχει (π.χ. Super Admin) → χωρίς σύνδεσμο. */
  accountHref?: string | null;
}) {
  const tr = useT();
  const { locale, changeLocale, savingLocale, logout } = useAccountActions();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Κλείσιμο με κλικ έξω ή Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const roleLabel = ROLE_LABEL_KEY[role] ? tr(ROLE_LABEL_KEY[role]) : role;

  return (
    <div className={`dash-account dash-account--${variant}`} ref={wrap}>
      <button
        type="button"
        className="dash-account-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={tr("account.menu")}
        data-testid={`account-menu-${variant}`}
      >
        <span className="dash-user-avatar">{initialsOf(name) || "?"}</span>
        <span className="dash-account-who">
          <span className="dash-user-name">{name}</span>
          <span className="dash-user-role">{roleLabel}</span>
        </span>
        <ChevronDown size={16} className="dash-account-caret" />
      </button>

      {open && (
        <div className="dash-account-pop" id={menuId} role="menu">
          <div className="dash-account-head">
            <div className="dash-user-name">{name}</div>
            <div className="dash-account-email">{email}</div>
          </div>
          {accountHref && (
            <Link
              href={accountHref}
              className="dash-account-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
            >
              <UserRound size={16} /> {tr("account.title")}
            </Link>
          )}
          <div className="dash-lang" role="group" aria-label={tr("common.language")}>
            {LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                className={`dash-lang-btn ${locale === code ? "active" : ""}`}
                onClick={() => changeLocale(code)}
                disabled={savingLocale}
                aria-pressed={locale === code}
                title={tr(code === "el" ? "common.greek" : "common.english")}
              >
                {LOCALE_SHORT[code]}
              </button>
            ))}
          </div>
          <button type="button" className="dash-account-item dash-account-logout" role="menuitem" onClick={logout}>
            <LogOut size={16} /> {tr("common.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
