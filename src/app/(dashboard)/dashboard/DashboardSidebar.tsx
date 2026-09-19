"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  LogOut,
  Menu,
  X,
  Zap,
} from "lucide-react";

type Role = "COMPANY_ADMIN" | "STAFF" | "PARTNER" | string;

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: string | number }>;
  roles: Role[];
  disabled?: boolean;
}

// Φάση 1: μόνο το Dashboard είναι ενεργό. Τα υπόλοιπα ανοίγουν στη Φάση 2.
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Πίνακας", icon: LayoutDashboard, roles: ["COMPANY_ADMIN", "STAFF", "PARTNER"] },
  { href: "/dashboard/bookings", label: "Κρατήσεις", icon: CalendarDays, roles: ["COMPANY_ADMIN", "STAFF", "PARTNER"], disabled: true },
  { href: "/dashboard/calendar", label: "Ημερολόγιο", icon: CalendarDays, roles: ["COMPANY_ADMIN", "STAFF", "PARTNER"], disabled: true },
  { href: "/dashboard/fleet", label: "Στόλος", icon: Car, roles: ["COMPANY_ADMIN", "STAFF", "PARTNER"], disabled: true },
  { href: "/dashboard/customers", label: "Πελάτες", icon: Users, roles: ["COMPANY_ADMIN", "STAFF"], disabled: true },
  { href: "/dashboard/contracts", label: "Συμβόλαια", icon: FileText, roles: ["COMPANY_ADMIN", "STAFF"], disabled: true },
  { href: "/dashboard/invoices", label: "Τιμολόγια", icon: Receipt, roles: ["COMPANY_ADMIN", "STAFF"], disabled: true },
  { href: "/dashboard/service", label: "Service & Ζημιές", icon: Wrench, roles: ["COMPANY_ADMIN", "STAFF"], disabled: true },
  { href: "/dashboard/reports", label: "Αναφορές", icon: BarChart3, roles: ["COMPANY_ADMIN"], disabled: true },
  { href: "/dashboard/finance", label: "Οικονομικά", icon: Wallet, roles: ["COMPANY_ADMIN"], disabled: true },
  { href: "/dashboard/users", label: "Χρήστες", icon: UserCog, roles: ["COMPANY_ADMIN"], disabled: true },
  { href: "/dashboard/settings", label: "Ρυθμίσεις", icon: Settings, roles: ["COMPANY_ADMIN"], disabled: true },
];

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: "Διαχειριστής",
  STAFF: "Προσωπικό",
  PARTNER: "Συνεργάτης",
};

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
  const [open, setOpen] = useState(false);

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
          aria-label="Μενού"
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
            aria-label="Κλείσιμο"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="dash-nav">
          {items.map((it) => {
            const Icon = it.icon;
            const active = pathname === it.href;
            if (it.disabled) {
              return (
                <div key={it.href} className="dash-nav-item disabled">
                  <Icon size={18} />
                  <span>{it.label}</span>
                  <span className="dash-soon">σύντομα</span>
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
                <span>{it.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="dash-user">
          <div className="dash-user-avatar">{initials || "?"}</div>
          <div className="dash-user-info">
            <div className="dash-user-name">{name}</div>
            <div className="dash-user-role">{ROLE_LABEL[role] || role}</div>
          </div>
          <button
            className="dash-logout"
            onClick={handleLogout}
            aria-label="Αποσύνδεση"
            title="Αποσύνδεση"
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
}
