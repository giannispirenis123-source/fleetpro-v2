"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import { can, type PermissionMap } from "@/lib/permissions";
import { LOCALES, type Locale } from "@/lib/i18n/locale";
import {
  LayoutDashboard,
  CalendarDays,
  Car,
  Users,
  Tag,
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
  /** Το δικαίωμα προβολής της ενότητας — από το μητρώο δικαιωμάτων. */
  permission: string;
  disabled?: boolean;
}

// Η ορατότητα ΔΕΝ κρίνεται πια από τον ρόλο αλλά από το δικαίωμα προβολής.
// Ο διαχειριστής τα έχει όλα, οπότε βλέπει τα πάντα.
// Ενεργά: Πίνακας, Κρατήσεις, Ημερολόγιο, Στόλος, Πρόσθετα, Πελάτες,
// Εκπτώσεις, Τιμολόγια, Χρήστες, Ρυθμίσεις.
const NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "overview", icon: LayoutDashboard, permission: "dashboard.view" },
  { href: "/dashboard/bookings", labelKey: "bookings", icon: CalendarDays, permission: "bookings.view" },
  { href: "/dashboard/calendar", labelKey: "calendar", icon: CalendarDays, permission: "calendar.view" },
  { href: "/dashboard/fleet", labelKey: "fleet", icon: Car, permission: "fleet.view" },
  { href: "/dashboard/extras", labelKey: "extras", icon: PackagePlus, permission: "extras.view" },
  { href: "/dashboard/customers", labelKey: "customers", icon: Users, permission: "customers.view" },
  { href: "/dashboard/discounts", labelKey: "discounts", icon: Tag, permission: "discounts.view" },
  { href: "/dashboard/contracts", labelKey: "contracts", icon: FileText, permission: "contracts.view", disabled: true },
  { href: "/dashboard/invoices", labelKey: "invoices", icon: Receipt, permission: "invoices.view" },
  { href: "/dashboard/service", labelKey: "service", icon: Wrench, permission: "service.view", disabled: true },
  { href: "/dashboard/reports", labelKey: "reports", icon: BarChart3, permission: "reports.view", disabled: true },
  { href: "/dashboard/finance", labelKey: "finance", icon: Wallet, permission: "finance.view", disabled: true },
  { href: "/dashboard/users", labelKey: "users", icon: UserCog, permission: "users.view" },
  { href: "/dashboard/settings", labelKey: "settings", icon: Settings, permission: "settings.view" },
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
  permissions,
  companyName,
}: {
  name: string;
  role: Role;
  permissions: PermissionMap;
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

  // Οι ενότητες «σύντομα» μένουν ορατές σε όλους ως ένδειξη τού τι
  // έρχεται· οι υπόλοιπες μόνο σε όποιον έχει το δικαίωμα προβολής.
  const items = NAV.filter(
    (it) => it.disabled || can(role, permissions, it.permission)
  );

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
