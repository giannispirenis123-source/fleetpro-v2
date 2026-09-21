"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import { LOCALES, type Locale } from "@/lib/i18n/locale";
import {
  LayoutDashboard,
  CalendarDays,
  Car,
  Users,
  FileText,
  Receipt,
  Wrench,
  BarChart3,
  Wallet,
  UserCog,
  Settings,
  PackagePlus,
  LogOut,
  Menu,
  X,
  Zap,
} from "lucide-react";

type Role = "COMPANY_ADMIN" | "STAFF" | "PARTNER" | string;

interface NavItem {
  href: string;
  /** Κλειδί μετάφρασης στο namespace "sidebar". */
  labelKey: string;
  icon: React.ComponentType<{ size?: string | number }>;
  roles: Role[];
  disabled?: boolean;
}

// Ενεργά: Πίνακας, Κρατήσεις, Στόλος, Πρόσθετα, Πελάτες, Ρυθμίσεις.
const NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "overview", icon: LayoutDashboard, roles: ["COMPANY_ADMIN", "STAFF", "PARTNER"] },
  { href: "/dashboard/bookings", labelKey: "bookings", icon: CalendarDays, roles: ["COMPANY_ADMIN", "STAFF", "PARTNER"] },
  { href: "/dashboard/calendar", labelKey: "calendar", icon: CalendarDays, roles: ["COMPANY_ADMIN", "STAFF", "PARTNER"], disabled: true },
  { href: "/dashboard/fleet", labelKey: "fleet", icon: Car, roles: ["COMPANY_ADMIN", "STAFF", "PARTNER"] },
  { href: "/dashboard/extras", labelKey: "extras", icon: PackagePlus, roles: ["COMPANY_ADMIN", "STAFF", "PARTNER"] },
  { href: "/dashboard/customers", labelKey: "customers", icon: Users, roles: ["COMPANY_ADMIN", "STAFF"] },
  { href: "/dashboard/contracts", labelKey: "contracts", icon: FileText, roles: ["COMPANY_ADMIN", "STAFF"], disabled: true },
  { href: "/dashboard/invoices", labelKey: "invoices", icon: Receipt, roles: ["COMPANY_ADMIN", "STAFF"], disabled: true },
  { href: "/dashboard/service", labelKey: "service", icon: Wrench, roles: ["COMPANY_ADMIN", "STAFF"], disabled: true },
  { href: "/dashboard/reports", labelKey: "reports", icon: BarChart3, roles: ["COMPANY_ADMIN"], disabled: true },
  { href: "/dashboard/finance", labelKey: "finance", icon: Wallet, roles: ["COMPANY_ADMIN"], disabled: true },
  { href: "/dashboard/users", labelKey: "users", icon: UserCog, roles: ["COMPANY_ADMIN"], disabled: true },
  { href: "/dashboard/settings", labelKey: "settings", icon: Settings, roles: ["COMPANY_ADMIN"] },
];

const ROLE_LABEL_KEY: Record<string, string> = {
  COMPANY_ADMIN: "sidebar.roleCompanyAdmin",
  STAFF: "sidebar.roleStaff",
  PARTNER: "sidebar.rolePartner",
};

const LOCALE_SHORT: Record<Locale, string> = { el: "ΕΛ", en: "EN" };

export default function DashboardSidebar({
  name,
  role,
  companyName,
}: {
  name: string;
  role: Role;
  companyName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const tr = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [savingLocale, startSavingLocale] = useTransition();

  // Αποθηκεύει τη γλώσσα στον χρήστη και ανανεώνει, ώστε ο server
  // να ξαναφτιάξει τη σελίδα στη νέα γλώσσα.
  const changeLocale = (next: Locale) => {
    if (next === locale || savingLocale) return;
    startSavingLocale(async () => {
      await fetch("/api/users/me/locale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      router.refresh();
    });
  };

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const items = NAV.filter((it) => it.roles.includes(role));

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="dash-topbar">
        <button
          className="dash-hamburger"
          onClick={() => setOpen(true)}
          aria-label={tr("common.menu")}
        >
          <Menu size={20} />
        </button>
        <div className="dash-brand-logo">
          <Zap size={18} />
        </div>
        <span className="dash-brand-name">FleetPro</span>
      </div>

      {/* Overlay */}
      <div
        className={`dash-overlay ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`dash-sidebar ${open ? "open" : ""}`}>
        <div className="dash-brand">
          <div className="dash-brand-logo">
            <Zap size={18} />
          </div>
          <div>
            <span className="dash-brand-name">FleetPro</span>
            <span className="dash-brand-sub">{companyName}</span>
          </div>
          <button
            className="dash-hamburger"
            style={{ marginLeft: "auto", display: "none" }}
            onClick={() => setOpen(false)}
            aria-label={tr("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="dash-nav">
          {items.map((it) => {
            const Icon = it.icon;
            // Το "/dashboard" θέλει ακριβή ισότητα, αλλιώς θα ήταν πάντα ενεργό.
            const active =
              it.href === "/dashboard"
                ? pathname === it.href
                : pathname === it.href ||
                  pathname.startsWith(`${it.href}/`);
            if (it.disabled) {
              return (
                <div key={it.href} className="dash-nav-item disabled">
                  <Icon size={18} />
                  <span>{tr(`sidebar.${it.labelKey}`)}</span>
                  <span className="dash-soon">{tr("common.comingSoon")}</span>
                </div>
              );
            }
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`dash-nav-item ${active ? "active" : ""}`}
                onClick={() => setOpen(false)}
              >
                <Icon size={18} />
                <span>{tr(`sidebar.${it.labelKey}`)}</span>
              </Link>
            );
          })}
        </nav>

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

        <div className="dash-user">
          <div className="dash-user-avatar">{initials || "?"}</div>
          <div className="dash-user-info">
            <div className="dash-user-name">{name}</div>
            <div className="dash-user-role">
              {ROLE_LABEL_KEY[role] ? tr(ROLE_LABEL_KEY[role]) : role}
            </div>
          </div>
          <button
            className="dash-logout"
            onClick={handleLogout}
            aria-label={tr("common.logout")}
            title={tr("common.logout")}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
}
