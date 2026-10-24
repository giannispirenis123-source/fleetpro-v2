"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/I18nProvider";
import { can, type PermissionMap } from "@/lib/permissions";
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
  Menu,
  X,
  Zap,
  Globe,
} from "lucide-react";
import type { ModuleKey } from "@/lib/entitlementsCore";
import AccountMenu from "@/components/account/AccountMenu";

type Role = "COMPANY_ADMIN" | "STAFF" | "PARTNER" | string;

interface NavItem {
  href: string;
  /** Κλειδί μετάφρασης στο namespace "sidebar". */
  labelKey: string;
  icon: React.ComponentType<{ size?: string | number }>;
  /** Το δικαίωμα προβολής της ενότητας — από το μητρώο δικαιωμάτων. */
  permission: string;
  disabled?: boolean;
  /** Κρυφό για συνεργάτη ανεξαρτήτως δικαιώματος (σύνολα εταιρίας). */
  hideForPartner?: boolean;
  /** Μόνο για Διαχειριστή εταιρίας. */
  adminOnly?: boolean;
  /** Ενότητα πακέτου: χωρίς αυτήν φαίνεται κλειδωμένο («Δεν περιλαμβάνεται»). */
  module?: ModuleKey;
}

// Η ορατότητα ΔΕΝ κρίνεται πια από τον ρόλο αλλά από το δικαίωμα προβολής.
// Ο διαχειριστής τα έχει όλα, οπότε βλέπει τα πάντα.
// Ενεργά: Πίνακας, Κρατήσεις, Ημερολόγιο, Στόλος, Πρόσθετα, Πελάτες,
// Εκπτώσεις, Συμβόλαια, Τιμολόγια, Service & Ζημιές, Αναφορές, Οικονομικά,
// Χρήστες, Ρυθμίσεις.
const NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "overview", icon: LayoutDashboard, permission: "dashboard.view" },
  { href: "/dashboard/bookings", labelKey: "bookings", icon: CalendarDays, permission: "bookings.view" },
  { href: "/dashboard/calendar", labelKey: "calendar", icon: CalendarDays, permission: "calendar.view" },
  { href: "/dashboard/fleet", labelKey: "fleet", icon: Car, permission: "fleet.view" },
  { href: "/dashboard/extras", labelKey: "extras", icon: PackagePlus, permission: "extras.view" },
  { href: "/dashboard/customers", labelKey: "customers", icon: Users, permission: "customers.view" },
  { href: "/dashboard/discounts", labelKey: "discounts", icon: Tag, permission: "discounts.view" },
  { href: "/dashboard/contracts", labelKey: "contracts", icon: FileText, permission: "contracts.view" },
  { href: "/dashboard/invoices", labelKey: "invoices", icon: Receipt, permission: "invoices.view" },
  { href: "/dashboard/service", labelKey: "service", icon: Wrench, permission: "service.view" },
  { href: "/dashboard/reports", labelKey: "reports", icon: BarChart3, permission: "reports.view", hideForPartner: true },
  { href: "/dashboard/finance", labelKey: "finance", icon: Wallet, permission: "finance.view" },
  { href: "/dashboard/users", labelKey: "users", icon: UserCog, permission: "users.view" },
  { href: "/dashboard/settings", labelKey: "settings", icon: Settings, permission: "settings.view" },
  { href: "/dashboard/storefront", labelKey: "storefront", icon: Globe, permission: "settings.edit", adminOnly: true, module: "publicSite" },
];

export default function DashboardSidebar({
  name,
  email,
  role,
  permissions,
  companyName,
  modules,
}: {
  name: string;
  email: string;
  role: Role;
  permissions: PermissionMap;
  companyName: string;
  /** Οι ενότητες του πακέτου της εταιρίας (από τον server). */
  modules: Record<ModuleKey, boolean>;
}) {
  const pathname = usePathname();
  const tr = useT();
  const [open, setOpen] = useState(false);
  // Μενού λογαριασμού: «Συνδρομή» μόνο για τον Διαχειριστή, «Πες μας τη γνώμη σου» για όλους.
  const accountLinks = [
    ...(role === "COMPANY_ADMIN" ? [{ href: "/dashboard/billing", labelKey: "account.menuBilling", icon: "billing" as const }] : []),
    { href: "/dashboard/feedback", labelKey: "account.menuFeedback", icon: "feedback" as const },
  ];

  // Οι ενότητες «σύντομα» μένουν ορατές σε όλους ως ένδειξη τού τι
  // έρχεται· οι υπόλοιπες μόνο σε όποιον έχει το δικαίωμα προβολής.
  const items = NAV.filter(
    (it) =>
      it.disabled ||
      (can(role, permissions, it.permission) &&
        !(it.hideForPartner && role === "PARTNER") &&
        !(it.adminOnly && role !== "COMPANY_ADMIN"))
  );

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
        {/* Λογαριασμός: σταθερά ορατός στο κινητό, χωρίς να ανοίξει το μενού. */}
        <AccountMenu name={name} email={email} role={role} variant="topbar" links={accountLinks} />
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

        {/* Λογαριασμός: στην ΚΟΡΥΦΗ του sidebar (desktop) — πάντα ορατός. */}
        <AccountMenu name={name} email={email} role={role} variant="sidebar" onNavigate={() => setOpen(false)} links={accountLinks} />

        <nav className="dash-nav">
          {items.map((it) => {
            const Icon = it.icon;
            // Το "/dashboard" θέλει ακριβή ισότητα, αλλιώς θα ήταν πάντα ενεργό.
            const active =
              it.href === "/dashboard"
                ? pathname === it.href
                : pathname === it.href ||
                  pathname.startsWith(`${it.href}/`);
            if (it.module && !modules[it.module]) {
              return (
                <div
                  key={it.href}
                  className="dash-nav-item disabled"
                  title={tr("common.notInPlan")}
                >
                  <Icon size={18} />
                  <span>{tr(`sidebar.${it.labelKey}`)}</span>
                  <span className="dash-soon">{tr("common.notInPlanShort")}</span>
                </div>
              );
            }
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

      </aside>
    </>
  );
}
