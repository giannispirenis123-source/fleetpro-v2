// src/app/(super-admin)/super-admin/page.tsx
// Super Admin Dashboard — διαχείριση όλης της πλατφόρμας

"use client";

import { formatEuros } from "@/lib/public/money";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Users,
  Car,
  TrendingUp,
  Plus,
  Search,
  MoreVertical,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Shield,
  Eye,
  EyeOff,
  Edit,
  Trash2,
  ArrowUpRight,
  BarChart3,
  Globe,
  CreditCard,
  Tag,
  ChevronDown,
  Activity,
  Zap,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import AccountMenu from "@/components/account/AccountMenu";
import { useSuperAdminUser } from "./SuperAdminUser";
import {
  PLAN_PRICES,
  discountedPrice,
  platformDiscountStatus,
  todayISO,
  type PlatformDiscountDTO,
  type PlatformDiscountStatus,
} from "@/lib/platformDiscounts";

// ─── Types ───────────────────────────────

type TenantStatus = "ACTIVE" | "SUSPENDED" | "TRIAL" | "CANCELLED";
type SubscriptionPlan = "STARTER" | "PRO" | "ENTERPRISE";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone?: string;
  status: TenantStatus;
  plan: SubscriptionPlan;
  /** Πακέτο (entitlements) — κλειδί του πίνακα plans· null = χωρίς πακέτο. */
  planKey: string | null;
  brandColor: string;
  logoUrl?: string;
  trialEndsAt?: string;
  createdAt: string;
  /** Προμήθεια πλατφόρμας στις online πληρωμές (basis points). */
  platformFeeBps?: number;
  /** SQL 34: manual (Super Admin) | self_signup (/signup). */
  signupSource?: "manual" | "self_signup";
  /** Τουλάχιστον ένας χρήστης με επαληθευμένο email. */
  emailVerified?: boolean;
  /** Σημάνθηκε για καθάρισμα (ανεπιβεβαίωτη εγγραφή > 7 ημέρες). */
  cleanupFlaggedAt?: string | null;
  /** Συνδρομή (SQL 36): exempt | founder_trial | awaiting_checkout | κατάσταση Stripe. */
  billingStatus?: string;
  billingInterval?: "month" | "year";
  /** Θέση στο πρόγραμμα «Πρώτες 10 εταιρίες» (1–10) ή null. */
  founderSlot?: number | null;
  /** Test clock του Stripe (μόνο Preview, SQL 37). */
  stripeTestClockId?: string | null;
  /** Τιμολόγια ιδρυτή πληρωμένα ΧΩΡΙΣ έκπτωση (SQL 37). */
  founderFullCharges?: { stripeInvoiceId: string; amountCents: number }[];
  _count: {
    users: number;
    vehicles: number;
    bookings: number;
  };
}

interface PlatformStats {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  totalVehicles: number;
  totalBookings: number;
  mrr: number;
}

/** Ρόλοι χρηστών εταιρίας — ο SUPER_ADMIN δεν ρεσετάρεται από εδώ. */
type UserRole = "SUPER_ADMIN" | "COMPANY_ADMIN" | "STAFF" | "PARTNER";

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
}

// ─── Constants ───────────────────────────

type SaTab = "tenants" | "stats" | "discounts" | "founding" | "feedback" | "settings";

/** Οι ενότητες του Super Admin — ΜΙΑ λίστα για το πλαϊνό μενού (desktop) και τη μπάρα του κινητού. */
const SA_TABS: { id: SaTab; label: string; icon: React.ReactNode }[] = [
  { id: "tenants", label: "Εταιρίες", icon: <Building2 size={16} /> },
  { id: "stats", label: "Στατιστικά", icon: <BarChart3 size={16} /> },
  { id: "discounts", label: "Εκπτώσεις", icon: <Tag size={16} /> },
  { id: "founding", label: "Πρώτες εταιρίες", icon: <Zap size={16} /> },
  { id: "feedback", label: "Γνώμες", icon: <Activity size={16} /> },
  { id: "settings", label: "Ρυθμίσεις", icon: <Shield size={16} /> },
];

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  STARTER: "Starter",
  PRO: "Pro",
  // Το παλιό ENTERPRISE αντιστοιχεί στο πλάνο Business (SQL 36).
  ENTERPRISE: "Business",
};

/** Κατάσταση συνδρομής (SQL 36) — ετικέτες Super Admin. */
const BILLING_LABELS: Record<string, string> = {
  exempt: "Εκτός χρέωσης",
  founder_trial: "Δοκιμή ιδρυτή",
  awaiting_checkout: "Αναμονή κάρτας",
  trialing: "Δοκιμή (κάρτα)",
  active: "Ενεργή",
  past_due: "Απλήρωτη",
  unpaid: "Απλήρωτη",
  canceled: "Ακυρωμένη",
  incomplete: "Μη ολοκληρωμένη",
  incomplete_expired: "Έληξε",
  paused: "Σε παύση",
};

/** Κατά προσέγγιση ύψος του μενού ενεργειών, για να κρίνουμε αν χωράει. */
const MENU_HEIGHT = 190;

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  COMPANY_ADMIN: "Διαχειριστής",
  STAFF: "Προσωπικό",
  PARTNER: "Συνεργάτης",
};

const STATUS_CONFIG: Record<
  TenantStatus,
  { label: string; color: string; icon: React.ReactNode }
> = {
  ACTIVE: {
    label: "Ενεργή",
    color: "text-emerald-400 bg-emerald-400/10",
    icon: <CheckCircle size={12} />,
  },
  TRIAL: {
    label: "Δοκιμαστική",
    color: "text-amber-400 bg-amber-400/10",
    icon: <Clock size={12} />,
  },
  SUSPENDED: {
    label: "Ανασταλμένη",
    color: "text-red-400 bg-red-400/10",
    icon: <XCircle size={12} />,
  },
  CANCELLED: {
    label: "Ακυρωμένη",
    color: "text-slate-400 bg-slate-400/10",
    icon: <XCircle size={12} />,
  },
};

/**
 * Τα στατιστικά της πλατφόρμας βγαίνουν από την ίδια τη λίστα εταιριών.
 * Το MRR μετρά μόνο τις ενεργές συνδρομές — οι δοκιμαστικές δεν πληρώνουν.
 */
function computeStats(list: Tenant[]): PlatformStats {
  return {
    totalTenants: list.length,
    activeTenants: list.filter((t) => t.status === "ACTIVE").length,
    trialTenants: list.filter((t) => t.status === "TRIAL").length,
    totalVehicles: list.reduce((sum, t) => sum + t._count.vehicles, 0),
    totalBookings: list.reduce((sum, t) => sum + t._count.bookings, 0),
    mrr: list
      .filter((t) => t.status === "ACTIVE")
      .reduce((sum, t) => sum + PLAN_PRICES[t.plan], 0),
  };
}

// ─── Main Component ──────────────────────

export default function SuperAdminDashboard() {
  const me = useSuperAdminUser();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<TenantStatus | "ALL">("ALL");
  const [filterPlan, setFilterPlan] = useState<SubscriptionPlan | "ALL">("ALL");
  const [filterSource, setFilterSource] = useState<"ALL" | "manual" | "self_signup">("ALL");
  const [cleanup, setCleanup] = useState<{ count: number; message: string } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [showTenantMenu, setShowTenantMenu] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  // Εταιρία της οποίας βλέπουμε τους χρήστες (λίστα + reset κωδικού).
  const [usersOfTenant, setUsersOfTenant] = useState<Tenant | null>(null);
  // Οριστική διαγραφή εταιρίας (επιβεβαίωση με το ακριβές όνομα).
  const [deletingTenant, setDeletingTenant] = useState<Tenant | null>(null);
  const [activeTab, setActiveTab] = useState<SaTab>("tenants");
  // Μετρητής θέσεων του προγράμματος ιδρυτών (SQL 36).
  const [founding, setFounding] = useState<FoundingView | null>(null);
  const loadFounding = useCallback(async () => {
    try {
      const res = await fetch("/api/super-admin/founding");
      if (res.ok) setFounding((await res.json()).data);
    } catch {
      /* ο μετρητής είναι βοηθητικός */
    }
  }, []);
  useEffect(() => {
    loadFounding();
  }, [loadFounding]);

  // ─── Φόρτωση εταιριών από το API ───
  const loadTenants = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/tenants?limit=100");
      const data = await res.json();

      if (!res.ok) {
        setLoadError(data.message || "Δεν ήταν δυνατή η φόρτωση των εταιριών");
        return;
      }

      const list: Tenant[] = data.data.tenants;
      setTenants(list);
      setStats(computeStats(list));
    } catch {
      setLoadError("Σφάλμα σύνδεσης");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  const filteredTenants = tenants.filter((t) => {
    const matchSearch =
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.email.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.includes(search.toLowerCase());
    const matchStatus = filterStatus === "ALL" || t.status === filterStatus;
    const matchPlan = filterPlan === "ALL" || t.plan === filterPlan;
    const matchSource = filterSource === "ALL" || (t.signupSource ?? "manual") === filterSource;
    return matchSearch && matchStatus && matchPlan && matchSource;
  });

  // Αναστολή/ενεργοποίηση με τον ΥΠΑΡΧΟΝΤΑ μηχανισμό (PATCH /api/tenants/[id] status).
  const changeStatus = async (tenant: Tenant, status: TenantStatus) => {
    setShowTenantMenu(null);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.message || "Η αλλαγή κατάστασης απέτυχε");
        return;
      }
      setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, status } : t)));
    } catch {
      setLoadError("Σφάλμα σύνδεσης");
    }
  };

  // Ανεπιβεβαίωτες εγγραφές > 7 ημέρες: ΜΟΝΟ σήμανση, όχι διαγραφή.
  const flagCleanup = async () => {
    try {
      const res = await fetch("/api/super-admin/signup-cleanup", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCleanup({ count: 0, message: data.message || "Σφάλμα" });
        return;
      }
      setCleanup({
        count: data.data.items.length,
        message: `Σημάνθηκαν ${data.data.flagged} · ανεπιβεβαίωτες > 7 ημ.: ${data.data.items.length}`,
      });
      loadTenants();
    } catch {
      setCleanup({ count: 0, message: "Σφάλμα σύνδεσης" });
    }
  };

  return (
    <div className="sa-root">
      {/* ── Sidebar ──────────────────────── */}
      <aside className="sa-sidebar">
        <div className="sa-logo">
          <Zap size={20} className="sa-logo-icon" />
          <span>FleetPro</span>
          <span className="sa-badge">Super Admin</span>
        </div>

        {/* Λογαριασμός: ΚΟΡΥΦΗ του sidebar (desktop). Χωρίς «Ο λογαριασμός μου»:
            ο Super Admin δεν έχει τέτοια σελίδα. */}
        <AccountMenu name={me.name} email={me.email} role="SUPER_ADMIN" variant="sidebar" accountHref={null} />

        <nav className="sa-nav">
          {SA_TABS.map((item) => (
            <button
              key={item.id}
              className={`sa-nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

      </aside>

      {/* ── Main Content ─────────────────── */}
      <main className="sa-main">
        {/* Στο κινητό η πλαϊνή στήλη κρύβεται: σταθερή μπάρα με το ΙΔΙΟ μενού λογαριασμού. */}
        <div className="sa-mobile-bar">
          <span className="sa-mobile-brand">
            <Zap size={16} className="sa-logo-icon" /> FleetPro
          </span>
          <AccountMenu name={me.name} email={me.email} role="SUPER_ADMIN" variant="topbar" accountHref={null} />
          {/* Στο κινητό (≤768px) οι ΙΔΙΕΣ ενότητες με το πλαϊνό μενού, σε οριζόντια μπάρα με κύλισμα. */}
          <nav className="sa-mobile-tabs" aria-label="Ενότητες Super Admin">
            {SA_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`sa-mobile-tab ${activeTab === item.id ? "active" : ""}`}
                aria-current={activeTab === item.id ? "page" : undefined}
                onClick={(e) => {
                  setActiveTab(item.id);
                  // Η ενεργή καρτέλα ολόκληρη ορατή στη μπάρα· η σελίδα από την αρχή.
                  e.currentTarget.scrollIntoView({ inline: "center", block: "nearest" });
                  window.scrollTo({ top: 0 });
                }}
                data-testid={`sa-tab-${item.id}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        {/* Stats Bar */}
        {stats && (
          <div className="sa-stats-bar">
            {[
              {
                label: "Συνολικές Εταιρίες",
                value: stats.totalTenants,
                icon: <Building2 size={14} />,
                accent: "#6366f1",
              },
              {
                label: "Ενεργές",
                value: stats.activeTenants,
                icon: <Activity size={14} />,
                accent: "#10b981",
              },
              {
                label: "Δοκιμαστικές",
                value: stats.trialTenants,
                icon: <Clock size={14} />,
                accent: "#f59e0b",
              },
              {
                label: "Σύνολο Οχήματα",
                value: stats.totalVehicles,
                icon: <Car size={14} />,
                accent: "#3b82f6",
              },
              {
                label: "Κρατήσεις",
                value: stats.totalBookings,
                icon: <TrendingUp size={14} />,
                accent: "#8b5cf6",
              },
              {
                label: "MRR",
                value: formatEuros(stats.mrr, "el"),
                icon: <CreditCard size={14} />,
                accent: "#ec4899",
              },
            ].map((s) => (
              <div key={s.label} className="sa-stat-card">
                <div
                  className="sa-stat-icon"
                  style={{ color: s.accent, background: `${s.accent}18` }}
                >
                  {s.icon}
                </div>
                <div>
                  <div className="sa-stat-value">{s.value}</div>
                  <div className="sa-stat-label">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tenants Tab */}
        {activeTab === "tenants" && (
          <div className="sa-content">
            {/* Toolbar */}
            <div className="sa-toolbar">
              <div className="sa-toolbar-left">
                <h1 className="sa-page-title">Εταιρίες Πελάτες</h1>
                <span className="sa-count">{filteredTenants.length}</span>
              </div>
              <div className="sa-toolbar-right">
                <div className="sa-search">
                  <Search size={14} />
                  <input
                    placeholder="Αναζήτηση..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  className="sa-select"
                  value={filterStatus}
                  onChange={(e) =>
                    setFilterStatus(e.target.value as typeof filterStatus)
                  }
                >
                  <option value="ALL">Όλες</option>
                  <option value="ACTIVE">Ενεργές</option>
                  <option value="TRIAL">Δοκιμαστικές</option>
                  <option value="SUSPENDED">Ανασταλμένες</option>
                </select>
                <select
                  className="sa-select"
                  value={filterPlan}
                  onChange={(e) =>
                    setFilterPlan(e.target.value as typeof filterPlan)
                  }
                >
                  <option value="ALL">Όλα τα πλάνα</option>
                  <option value="STARTER">Starter</option>
                  <option value="PRO">Pro</option>
                  <option value="ENTERPRISE">Business</option>
                </select>
                <select
                  className="sa-select"
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value as typeof filterSource)}
                  aria-label="Προέλευση"
                >
                  <option value="ALL">Κάθε προέλευση</option>
                  <option value="manual">Manual</option>
                  <option value="self_signup">Self-signup</option>
                </select>
                {filterSource === "self_signup" && (
                  <button className="sa-btn-ghost" onClick={flagCleanup} title="Σήμανση ανεπιβεβαίωτων εγγραφών > 7 ημερών (χωρίς διαγραφή)">
                    Σήμανση για καθάρισμα
                  </button>
                )}
                <button
                  className="sa-btn-primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  <Plus size={14} />
                  Νέα Εταιρία
                </button>
              </div>
            </div>

            {cleanup && <div className="sa-load-error">{cleanup.message}</div>}

            {founding?.program && (
              <div className="sa-founding-strip" data-testid="founding-counter">
                Πρώτες εταιρίες: <strong>{founding.program.claimed}/{founding.program.maxSlots}</strong> θέσεις · απομένουν{" "}
                <strong>{founding.program.remaining}</strong>
                {!founding.program.active && " · το πρόγραμμα είναι κλειστό"}
              </div>
            )}

            {loadError && (
              <div className="sa-load-error">
                <AlertTriangle size={15} /> {loadError}
                <button className="sa-btn-ghost" onClick={loadTenants}>
                  Δοκίμασε ξανά
                </button>
              </div>
            )}

            {/* Table */}
            {loading ? (
              <div className="sa-loading">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="sa-skeleton" />
                ))}
              </div>
            ) : (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Εταιρία</th>
                      <th>Πλάνο</th>
                      <th>Συνδρομή</th>
                      <th>Ιδρυτής</th>
                      <th>Κατάσταση</th>
                      <th>Οχήματα</th>
                      <th>Χρήστες</th>
                      <th>Κρατήσεις</th>
                      <th>Προέλευση</th>
                      <th>Εγγραφή</th>
                      <th>Email επαλ.</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTenants.map((tenant) => (
                      <TenantRow
                        key={tenant.id}
                        tenant={tenant}
                        showMenu={showTenantMenu === tenant.id}
                        onMenuToggle={() =>
                          setShowTenantMenu(
                            showTenantMenu === tenant.id ? null : tenant.id
                          )
                        }
                        onEdit={() => setSelectedTenant(tenant)}
                        onShowUsers={() => {
                          setUsersOfTenant(tenant);
                          setShowTenantMenu(null);
                        }}
                        onStatusChange={(status) => changeStatus(tenant, status)}
                        onDelete={() => {
                          setDeletingTenant(tenant);
                          setShowTenantMenu(null);
                        }}
                      />
                    ))}
                  </tbody>
                </table>

                {filteredTenants.length === 0 && (
                  <div className="sa-empty">
                    <Building2 size={40} />
                    <p>Δεν βρέθηκαν εταιρίες</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Stats Tab */}
        {activeTab === "stats" && (
          <div className="sa-content">
            <div className="sa-toolbar">
              <h1 className="sa-page-title">Στατιστικά Πλατφόρμας</h1>
            </div>
            <PlatformStatsView tenants={tenants} stats={stats} />
          </div>
        )}

        {/* Discounts Tab */}
        {activeTab === "discounts" && (
          <div className="sa-content">
            <PlatformDiscountsView tenants={tenants} />
          </div>
        )}

        {activeTab === "founding" && (
          <div className="sa-content">
            <FoundingAdminView view={founding} onChange={setFounding} reload={loadFounding} />
          </div>
        )}

        {activeTab === "feedback" && (
          <div className="sa-content">
            <FeedbackAdminView />
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <div className="sa-content">
            <div className="sa-toolbar">
              <h1 className="sa-page-title">Ρυθμίσεις Πλατφόρμας</h1>
            </div>
            <PlatformSettingsView />
          </div>
        )}
      </main>

      {/* Create Tenant Modal */}
      {showCreateModal && (
        <CreateTenantModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={(tenant) => {
            setTenants((prev) => [tenant, ...prev]);
            setShowCreateModal(false);
          }}
        />
      )}

      {/* Χρήστες εταιρίας + reset κωδικού */}
      {usersOfTenant && (
        <TenantUsersModal
          tenant={usersOfTenant}
          onClose={() => setUsersOfTenant(null)}
        />
      )}

      {deletingTenant && (
        <DeleteTenantModal
          tenant={deletingTenant}
          onClose={() => setDeletingTenant(null)}
          onDeleted={(id) => {
            setTenants((prev) => {
              const next = prev.filter((t) => t.id !== id);
              setStats(computeStats(next));
              return next;
            });
            setDeletingTenant(null);
            loadFounding();
          }}
        />
      )}

      {/* Edit Tenant Modal */}
      {selectedTenant && (
        <EditTenantModal
          tenant={selectedTenant}
          onDelete={() => {
            setDeletingTenant(selectedTenant);
            setSelectedTenant(null);
          }}
          onClose={() => setSelectedTenant(null)}
          onSuccess={(updated) => {
            setTenants((prev) =>
              prev.map((t) => (t.id === updated.id ? updated : t))
            );
            setSelectedTenant(null);
          }}
        />
      )}

      <style dangerouslySetInnerHTML={{ __html: superAdminStyles }} />
    </div>
  );
}

// ─── Tenant Row Component ─────────────────

function TenantRow({
  tenant,
  showMenu,
  onMenuToggle,
  onEdit,
  onShowUsers,
  onStatusChange,
  onDelete,
}: {
  tenant: Tenant;
  showMenu: boolean;
  onMenuToggle: () => void;
  onEdit: () => void;
  onShowUsers: () => void;
  onStatusChange: (s: TenantStatus) => void;
  onDelete: () => void;
}) {
  // Το μενού ανοίγει προς τα κάτω· αν δεν χωράει στο ορατό παράθυρο
  // (τελευταία γραμμή, κοντό παράθυρο), γυρίζει προς τα πάνω.
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [openUp, setOpenUp] = useState(false);

  const handleMenuToggle = () => {
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setOpenUp(window.innerHeight - rect.bottom < MENU_HEIGHT + 16);
    }
    onMenuToggle();
  };

  const status = STATUS_CONFIG[tenant.status];
  const daysLeft = tenant.trialEndsAt
    ? Math.ceil(
        (new Date(tenant.trialEndsAt).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  return (
    <tr className="sa-table-row">
      <td>
        <div className="sa-tenant-cell">
          <div
            className="sa-tenant-dot"
            style={{ background: tenant.brandColor }}
          />
          <div>
            <div className="sa-tenant-name">{tenant.name}</div>
            <div className="sa-tenant-slug">
              {tenant.slug}.fleetpro.gr
            </div>
          </div>
        </div>
      </td>
      <td>
        <span
          className={`sa-plan-badge ${tenant.plan.toLowerCase()}`}
        >
          {PLAN_LABELS[tenant.plan]}
        </span>
      </td>
      <td>
        <span className="sa-source" data-testid="billing-status">
          {BILLING_LABELS[tenant.billingStatus ?? "exempt"] ?? tenant.billingStatus}
          {tenant.billingStatus && tenant.billingStatus !== "exempt" && tenant.billingInterval === "year" ? " · ετήσια" : ""}
        </span>
        {tenant.stripeTestClockId && (
          <span className="sa-plan-badge sa-testclock" title={tenant.stripeTestClockId} data-testid="test-clock-badge">Test clock</span>
        )}
        {(tenant.founderFullCharges ?? []).map((c) => (
          <div key={c.stripeInvoiceId} className="sa-trial-expired sa-full-charge" data-testid="full-charge">
            Πλήρης χρέωση χωρίς έκπτωση: {(c.amountCents / 100).toLocaleString("el-GR", { style: "currency", currency: "EUR" })} ({c.stripeInvoiceId})
          </div>
        ))}
      </td>
      <td>{tenant.founderSlot ? <span className="sa-plan-badge pro">#{tenant.founderSlot}</span> : "—"}</td>
      <td>
        <div className="sa-status-wrap">
          <span className={`sa-status ${status.color}`}>
            {status.icon}
            {status.label}
          </span>
          {daysLeft !== null && daysLeft > 0 && (
            <span className="sa-trial-days">{daysLeft}ημ.</span>
          )}
          {daysLeft !== null && daysLeft <= 0 && (
            <span className="sa-trial-expired">Έληξε</span>
          )}
        </div>
      </td>
      <td className="sa-num">{tenant._count.vehicles}</td>
      <td className="sa-num">{tenant._count.users}</td>
      <td className="sa-num">{tenant._count.bookings}</td>
      <td>
        <span className="sa-source">{tenant.signupSource === "self_signup" ? "self-signup" : "manual"}</span>
        {tenant.cleanupFlaggedAt && <span className="sa-trial-expired"> για καθάρισμα</span>}
      </td>
      <td className="sa-date">
        {new Date(tenant.createdAt).toLocaleDateString("el-GR")}
      </td>
      <td>{tenant.emailVerified === false ? <span className="sa-trial-expired">Όχι</span> : "Ναι"}</td>
      <td>
        <div className="sa-actions">
          <button
            className="sa-icon-btn"
            title="Προβολή Dashboard"
            onClick={() => window.open(`/dashboard?tenant=${tenant.slug}`, "_blank")}
          >
            <ArrowUpRight size={14} />
          </button>
          <div className="sa-menu-wrap">
            <button
              ref={menuBtnRef}
              className="sa-icon-btn"
              onClick={handleMenuToggle}
              aria-haspopup="menu"
              aria-expanded={showMenu}
              aria-label="Ενέργειες εταιρίας"
            >
              <MoreVertical size={14} />
            </button>
            {showMenu && (
              <div className={`sa-dropdown ${openUp ? "up" : ""}`}>
                <button onClick={onEdit}>
                  <Edit size={12} /> Επεξεργασία
                </button>
                <button onClick={onShowUsers}>
                  <Users size={12} /> Χρήστες & κωδικοί
                </button>
                {tenant.status !== "ACTIVE" && (
                  <button onClick={() => onStatusChange("ACTIVE")}>
                    <CheckCircle size={12} /> Ενεργοποίηση
                  </button>
                )}
                {tenant.status !== "SUSPENDED" && (
                  <button
                    className="danger"
                    onClick={() => onStatusChange("SUSPENDED")}
                  >
                    <XCircle size={12} /> Αναστολή
                  </button>
                )}
                <button className="danger" onClick={onDelete} data-testid="tenant-delete">
                  <Trash2 size={12} /> Διαγραφή εταιρίας
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Platform Stats View ──────────────────

function PlatformStatsView({
  tenants,
  stats,
}: {
  tenants: Tenant[];
  stats: PlatformStats | null;
}) {
  const planDistribution = tenants.reduce(
    (acc, t) => {
      acc[t.plan] = (acc[t.plan] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="sa-stats-grid">
      <div className="sa-stats-card">
        <h3>Κατανομή Πλάνων</h3>
        <div className="sa-plan-dist">
          {Object.entries(planDistribution).map(([plan, count]) => (
            <div key={plan} className="sa-plan-dist-row">
              <span className={`sa-plan-badge ${plan.toLowerCase()}`}>
                {PLAN_LABELS[plan as SubscriptionPlan]}
              </span>
              <div className="sa-plan-bar-wrap">
                <div
                  className="sa-plan-bar"
                  style={{
                    width: `${(count / tenants.length) * 100}%`,
                  }}
                />
              </div>
              <span className="sa-plan-count">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sa-stats-card">
        <h3>Μηνιαία Έσοδα (MRR)</h3>
        <div className="sa-mrr">
          <span className="sa-mrr-value">{stats?.mrr || 0}€</span>
          <span className="sa-mrr-label">/ μήνα</span>
        </div>
        <div className="sa-mrr-breakdown">
          {(["STARTER", "PRO", "ENTERPRISE"] as SubscriptionPlan[]).map(
            (plan) => {
              const count = planDistribution[plan] || 0;
              return (
                <div key={plan} className="sa-mrr-row">
                  <span>{PLAN_LABELS[plan]}</span>
                  <span>
                    {count} × {PLAN_PRICES[plan]}€ ={" "}
                    <strong>{count * PLAN_PRICES[plan]}€</strong>
                  </span>
                </div>
              );
            }
          )}
        </div>
      </div>

      <div className="sa-stats-card">
        <h3>Κατάσταση Εταιριών</h3>
        {(["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"] as TenantStatus[]).map(
          (status) => {
            const count = tenants.filter((t) => t.status === status).length;
            const cfg = STATUS_CONFIG[status];
            return (
              <div key={status} className="sa-status-row">
                <span className={`sa-status ${cfg.color}`}>
                  {cfg.icon} {cfg.label}
                </span>
                <span className="sa-status-count">{count}</span>
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}

// ─── Platform Discounts View ──────────────

/**
 * Εκπτώσεις στη ΣΥΝΔΡΟΜΗ εταιριών. Μόνο αποθήκευση/εμφάνιση — δεν
 * χρεώνονται ακόμα μέσω Stripe. Άσχετο με τις εκπτώσεις κρατήσεων.
 */
function PlatformDiscountsView({ tenants }: { tenants: Tenant[] }) {
  const tr = useT();
  const router = useRouter();
  const [discounts, setDiscounts] = useState<PlatformDiscountDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PlatformDiscountDTO | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/super-admin/platform-discounts", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || tr("platformDiscounts.errNetwork"));
        return;
      }
      setDiscounts(data.data.discounts);
    } catch {
      setError(tr("platformDiscounts.errNetwork"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    load();
  }, [load]);

  const afterChange = async () => {
    await load();
    router.refresh();
  };

  const toggleActive = async (d: PlatformDiscountDTO) => {
    setBusyId(d.id);
    setError("");
    try {
      const res = await fetch(`/api/super-admin/platform-discounts/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !d.active }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(platformDiscountError(res.status, data.message, tr));
        return;
      }
      await afterChange();
    } catch {
      setError(tr("platformDiscounts.errNetwork"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (d: PlatformDiscountDTO) => {
    if (!window.confirm(tr("platformDiscounts.confirmDelete"))) return;
    setBusyId(d.id);
    setError("");
    try {
      const res = await fetch(`/api/super-admin/platform-discounts/${d.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(platformDiscountError(res.status, data.message, tr));
        return;
      }
      await afterChange();
    } catch {
      setError(tr("platformDiscounts.errNetwork"));
    } finally {
      setBusyId(null);
    }
  };

  const today = todayISO();

  return (
    <>
      <div className="sa-toolbar">
        <div className="sa-toolbar-left">
          <h1 className="sa-page-title">{tr("platformDiscounts.title")}</h1>
          <span className="sa-count">{discounts.length}</span>
        </div>
        <button className="sa-btn-primary" onClick={() => setEditing("new")}>
          <Plus size={14} />
          {tr("platformDiscounts.newDiscount")}
        </button>
      </div>
      <p className="sa-muted-note">{tr("platformDiscounts.subtitle")}</p>

      {error && <div className="sa-error sa-pd-error">{error}</div>}

      {loading ? (
        <div className="sa-skeleton" />
      ) : discounts.length === 0 ? (
        <p className="sa-muted-note">{tr("platformDiscounts.empty")}</p>
      ) : (
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>{tr("platformDiscounts.colCompany")}</th>
                <th>{tr("platformDiscounts.colNote")}</th>
                <th>{tr("platformDiscounts.colType")}</th>
                <th>{tr("platformDiscounts.colValue")}</th>
                <th>{tr("platformDiscounts.colPlan")}</th>
                <th>{tr("platformDiscounts.colPeriod")}</th>
                <th>{tr("platformDiscounts.colStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => {
                const status = platformDiscountStatus(d, today);
                const base = PLAN_PRICES[d.tenantPlan];
                const final = discountedPrice(base, d);
                return (
                  <tr key={d.id} className="sa-table-row">
                    <td>
                      <strong>{d.tenantName}</strong>
                    </td>
                    <td className="sa-pd-note">{d.note || "—"}</td>
                    <td>{tr(`platformDiscounts.type${d.type}`)}</td>
                    <td>
                      <code className="sa-code">
                        {d.type === "PERCENTAGE"
                          ? `${d.value}%`
                          : `${formatEur(d.value)}${tr("platformDiscounts.perMonth")}`}
                      </code>
                    </td>
                    <td>
                      <span
                        className={`sa-plan-badge ${d.tenantPlan.toLowerCase()}`}
                      >
                        {PLAN_LABELS[d.tenantPlan]}
                      </span>{" "}
                      <span className="sa-pd-price">
                        <s>{formatEur(base)}</s> → <strong>{formatEur(final)}</strong>
                      </span>
                    </td>
                    <td className="sa-date">
                      {formatDay(d.validFrom)} →{" "}
                      {d.validUntil
                        ? formatDay(d.validUntil)
                        : tr("platformDiscounts.untilStopped")}
                    </td>
                    <td>
                      <span className={`sa-status sa-pd-${status.toLowerCase()}`}>
                        {PD_STATUS_ICON[status]}
                        {tr(`platformDiscounts.status${status}`)}
                      </span>
                    </td>
                    <td>
                      <div className="sa-actions">
                        <button
                          className="sa-icon-btn"
                          title={tr("platformDiscounts.edit")}
                          onClick={() => setEditing(d)}
                          disabled={busyId === d.id}
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          className="sa-icon-btn"
                          title={
                            d.active
                              ? tr("platformDiscounts.stop")
                              : tr("platformDiscounts.resume")
                          }
                          onClick={() => toggleActive(d)}
                          disabled={busyId === d.id}
                        >
                          {d.active ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                        </button>
                        <button
                          className="sa-icon-btn sa-pd-danger"
                          title={tr("platformDiscounts.delete")}
                          onClick={() => remove(d)}
                          disabled={busyId === d.id}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PlatformDiscountModal
          tenants={tenants}
          discount={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await afterChange();
          }}
        />
      )}
    </>
  );
}

const PD_STATUS_ICON: Record<PlatformDiscountStatus, React.ReactNode> = {
  ACTIVE: <CheckCircle size={12} />,
  SCHEDULED: <Clock size={12} />,
  EXPIRED: <XCircle size={12} />,
  INACTIVE: <PauseCircle size={12} />,
};

function formatEur(n: number): string {
  return formatEuros(n, "el");
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" χωρίς μετατροπή ζώνης ώρας. */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Μετάφραση των γνωστών σφαλμάτων του API· αλλιώς το μήνυμα του server. */
function platformDiscountError(
  status: number,
  message: string | undefined,
  tr: (key: string) => string
): string {
  if (status === 409) return tr("platformDiscounts.errOverlap");
  if (status === 404) return tr("platformDiscounts.errNotFound");
  return message || tr("platformDiscounts.errNetwork");
}

function PlatformDiscountModal({
  tenants,
  discount,
  onClose,
  onSaved,
}: {
  tenants: Tenant[];
  discount: PlatformDiscountDTO | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const tr = useT();
  const [form, setForm] = useState({
    tenantId: discount?.tenantId ?? "",
    type: discount?.type ?? ("PERCENTAGE" as PlatformDiscountDTO["type"]),
    value: discount ? String(discount.value) : "",
    validFrom: discount?.validFrom ?? todayISO(),
    validUntil: discount?.validUntil ?? "",
    active: discount?.active ?? true,
    note: discount?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const value = Number(form.value.replace(",", "."));
  const tenant = tenants.find((t) => t.id === form.tenantId);
  const plan = tenant?.plan ?? discount?.tenantPlan;
  const base = plan ? PLAN_PRICES[plan] : null;

  const validate = (): string => {
    if (!form.tenantId) return tr("platformDiscounts.errCompany");
    if (!Number.isFinite(value) || value <= 0) return tr("platformDiscounts.errValue");
    if (form.type === "PERCENTAGE" && value > 100) return tr("platformDiscounts.errPercent");
    if (!form.validFrom) return tr("platformDiscounts.errFrom");
    if (form.validUntil && form.validUntil < form.validFrom)
      return tr("platformDiscounts.errDates");
    return "";
  };

  const handleSubmit = async () => {
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        discount
          ? `/api/super-admin/platform-discounts/${discount.id}`
          : "/api/super-admin/platform-discounts",
        {
          method: discount ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: form.tenantId,
            type: form.type,
            value,
            validFrom: form.validFrom,
            validUntil: form.validUntil || null,
            active: form.active,
            note: form.note.trim() || null,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(platformDiscountError(res.status, data.message, tr));
        return;
      }
      await onSaved();
    } catch {
      setError(tr("platformDiscounts.errNetwork"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sa-modal-overlay" onClick={onClose}>
      <div className="sa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h2>
            {discount
              ? tr("platformDiscounts.editTitle")
              : tr("platformDiscounts.newTitle")}
          </h2>
          <button className="sa-modal-close" onClick={onClose}>
            <XCircle size={18} />
          </button>
        </div>
        <div className="sa-modal-body">
          <div className="sa-form-grid">
            <label className="sa-pd-full">
              {tr("platformDiscounts.fieldCompany")}
              <select
                value={form.tenantId}
                onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))}
              >
                <option value="">{tr("platformDiscounts.selectCompany")}</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {PLAN_LABELS[t.plan]} ({PLAN_PRICES[t.plan]}€)
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr("platformDiscounts.fieldType")}
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    type: e.target.value as PlatformDiscountDTO["type"],
                  }))
                }
              >
                <option value="PERCENTAGE">{tr("platformDiscounts.typePERCENTAGE")}</option>
                <option value="FIXED_AMOUNT">{tr("platformDiscounts.typeFIXED_AMOUNT")}</option>
              </select>
            </label>
            <label>
              {form.type === "PERCENTAGE"
                ? tr("platformDiscounts.fieldValuePct")
                : tr("platformDiscounts.fieldValueEur")}
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max={form.type === "PERCENTAGE" ? 100 : undefined}
                step="0.01"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
            </label>
            <label>
              {tr("platformDiscounts.fieldFrom")}
              <input
                type="date"
                value={form.validFrom}
                onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
              />
            </label>
            <label>
              {tr("platformDiscounts.fieldUntil")}
              <input
                type="date"
                value={form.validUntil}
                min={form.validFrom || undefined}
                onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
              />
            </label>
            <label className="sa-pd-full">
              {tr("platformDiscounts.fieldNote")}
              <input
                value={form.note}
                maxLength={500}
                placeholder={tr("platformDiscounts.notePlaceholder")}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </label>
            <label className="sa-pd-check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              {tr("platformDiscounts.fieldActive")}
            </label>
          </div>

          {base !== null && Number.isFinite(value) && value > 0 && (
            <div className="sa-pd-preview">
              {tr("platformDiscounts.preview")}: <s>{formatEur(base)}</s> →{" "}
              <strong>{formatEur(discountedPrice(base, { type: form.type, value }))}</strong>
              {tr("platformDiscounts.perMonth")}
            </div>
          )}

          {error && <div className="sa-error">{error}</div>}
        </div>
        <div className="sa-modal-footer">
          <button className="sa-btn-ghost" onClick={onClose}>
            {tr("platformDiscounts.cancel")}
          </button>
          <button className="sa-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? tr("platformDiscounts.saving") : tr("platformDiscounts.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Οριστική διαγραφή εταιρίας ───────────

interface DeleteSummary {
  id: string;
  name: string;
  counts: { users: number; vehicles: number; bookings: number; contracts: number; invoices: number; customers: number };
  blocked: string | null;
  stripeConnect: boolean;
  founderSlot: number | null;
}

function DeleteTenantModal({
  tenant,
  onClose,
  onDeleted,
}: {
  tenant: Tenant;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [summary, setSummary] = useState<DeleteSummary | null>(null);
  const [typed, setTyped] = useState("");
  const [releaseSlot, setReleaseSlot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/tenants/${tenant.id}/deletion`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) setSummary(d.data);
        else setError(d.message || "Σφάλμα");
      })
      .catch(() => setError("Σφάλμα σύνδεσης"));
  }, [tenant.id]);

  // Μόνο βοήθεια στο UI· ο server ελέγχει ξανά το ΑΚΡΙΒΕΣ όνομα.
  const matches = summary !== null && typed.trim() !== "" && typed.trim() === summary.name.trim();

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: typed, releaseFounderSlot: releaseSlot }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.message || "Η διαγραφή απέτυχε");
        return;
      }
      onDeleted(tenant.id);
    } catch {
      setError("Σφάλμα σύνδεσης");
    } finally {
      setBusy(false);
    }
  };

  const c = summary?.counts;
  return (
    <div className="sa-modal-overlay" onClick={onClose}>
      <div className="sa-modal sa-modal--sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-testid="delete-tenant-modal">
        <div className="sa-modal-header">
          <h2>Διαγραφή εταιρίας</h2>
          <button className="sa-modal-close" onClick={onClose} aria-label="Κλείσιμο">×</button>
        </div>
        <div className="sa-modal-body">
          {!summary && !error && <p className="sa-founding-note">Φόρτωση…</p>}
          {summary && (
            <>
              <p className="sa-delete-warn">
                Η διαγραφή είναι <strong>ΟΡΙΣΤΙΚΗ</strong>. Σβήνονται ΟΛΑ τα δεδομένα της εταιρίας <strong>{summary.name}</strong> και οι χρήστες της:
              </p>
              <ul className="sa-delete-list" data-testid="delete-counts">
                <li>{c!.users} χρήστες</li>
                <li>{c!.vehicles} οχήματα</li>
                <li>{c!.bookings} κρατήσεις</li>
                <li>{c!.contracts} συμβόλαια</li>
                <li>{c!.invoices} τιμολόγια</li>
                <li>{c!.customers} πελάτες</li>
              </ul>
              {summary.blocked && <div className="sa-error" role="alert">{summary.blocked}</div>}
              {summary.stripeConnect && (
                <div className="sa-load-error">
                  Η εταιρία έχει συνδεδεμένο λογαριασμό Stripe Connect. Ο λογαριασμός στο Stripe ΔΕΝ διαγράφεται· μόνο η σύνδεση εδώ.
                </div>
              )}
              {summary.founderSlot !== null && (
                <label className="sa-pd-check sa-delete-check">
                  <input type="checkbox" checked={releaseSlot} onChange={(e) => setReleaseSlot(e.target.checked)} />
                  Απελευθέρωση θέσης ιδρυτή #{summary.founderSlot} (αλλιώς η θέση μένει πιασμένη)
                </label>
              )}
              {!summary.blocked && (
                <label className="sa-label sa-delete-confirm">
                  Γράψε ακριβώς το όνομα της εταιρίας για επιβεβαίωση:
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={summary.name}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-testid="delete-confirm-name"
                  />
                </label>
              )}
            </>
          )}
          {error && <div className="sa-error" role="alert">{error}</div>}
        </div>
        <div className="sa-modal-footer">
          <button className="sa-btn-ghost" onClick={onClose}>Ακύρωση</button>
          <button
            className="sa-btn-danger"
            onClick={submit}
            disabled={busy || !summary || Boolean(summary.blocked) || !matches}
            data-testid="delete-confirm"
          >
            {busy ? "Διαγραφή…" : "Οριστική διαγραφή"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Πρώτες εταιρίες (SQL 36) ─────────────

interface FoundingView {
  program: { maxSlots: number; claimed: number; remaining: number; active: boolean } | null;
  codes: { id: string; label: string | null; maxClaims: number; claimedCount: number; active: boolean; expiresAt: string | null; createdAt: string }[];
  claims: { slot: number; claimedAt: string; codeLabel: string | null; tenantId: string | null; tenantName: string | null }[];
  notices: { tenantId: string; tenantName: string; endsAt: string; subject: string; text: string }[];
}

function FoundingAdminView({
  view,
  onChange,
  reload,
}: {
  view: FoundingView | null;
  onChange: (v: FoundingView) => void;
  reload: () => void;
}) {
  const [label, setLabel] = useState("");
  const [maxClaims, setMaxClaims] = useState(1);
  const [expiresOn, setExpiresOn] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const createCode = async () => {
    setBusy(true);
    setError("");
    setCreated(null);
    try {
      const res = await fetch("/api/super-admin/founding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined, maxClaims, expiresOn: expiresOn || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Σφάλμα");
        return;
      }
      // Ο κωδικός φαίνεται ΜΟΝΟ τώρα — στη βάση μένει μόνο το hash.
      setCreated(data.data.code);
      setLabel("");
      reload();
    } catch {
      setError("Σφάλμα σύνδεσης");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (body: Record<string, unknown>) => {
    setError("");
    const res = await fetch("/api/super-admin/founding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) onChange(data.data);
    else setError(data.message || "Σφάλμα");
  };

  if (!view?.program) {
    return <div className="sa-load-error">Το πρόγραμμα δεν βρέθηκε — έτρεξε το SQL 36;</div>;
  }
  const p = view.program;
  return (
    <>
      <div className="sa-toolbar">
        <h1 className="sa-page-title">Πρώτες 10 εταιρίες</h1>
      </div>
      <div className="sa-founding-strip">
        Θέσεις: <strong>{p.claimed}/{p.maxSlots}</strong> · απομένουν <strong>{p.remaining}</strong> ·{" "}
        {p.active ? "ανοιχτό" : "κλειστό"}{" "}
        <button className="sa-btn-ghost" onClick={() => patch({ programActive: !p.active })}>
          {p.active ? "Κλείσιμο προγράμματος" : "Άνοιγμα προγράμματος"}
        </button>
      </div>

      <div className="sa-settings-card">
        <h3>Νέος κωδικός ιδρυτή</h3>
        <div className="sa-form-grid">
          <label>Ετικέτα (για εσένα, π.χ. όνομα εταιρίας)<input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} /></label>
          <label>Μέγιστες χρήσεις<input type="number" min={1} max={10} value={maxClaims} onChange={(e) => setMaxClaims(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} /></label>
          <label>Λήξη (προαιρετικά)<input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></label>
        </div>
        <button className="sa-btn-primary" style={{ marginTop: 12 }} onClick={createCode} disabled={busy}>
          {busy ? "Δημιουργία..." : "Δημιουργία κωδικού"}
        </button>
        {created && (
          <div className="sa-founding-code" data-testid="founder-code-created">
            Κωδικός: <code>{created}</code> — αντίγραψέ τον τώρα· δεν θα ξαναφανεί.
          </div>
        )}
        {error && <div className="sa-error">{error}</div>}
      </div>

      <div className="sa-table-wrap" style={{ marginTop: 16 }}>
        <table className="sa-table">
          <thead>
            <tr><th>Ετικέτα</th><th>Χρήσεις</th><th>Λήξη</th><th>Κατάσταση</th><th></th></tr>
          </thead>
          <tbody>
            {view.codes.map((c) => (
              <tr key={c.id} className="sa-table-row">
                <td>{c.label || "—"}</td>
                <td className="sa-num">{c.claimedCount}/{c.maxClaims}</td>
                <td className="sa-date">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("el-GR") : "—"}</td>
                <td>{c.active ? "Ενεργός" : "Ανενεργός"}</td>
                <td>
                  <button className="sa-btn-ghost" onClick={() => patch({ codeId: c.id, codeActive: !c.active })}>
                    {c.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {view.codes.length === 0 && <div className="sa-empty"><p>Δεν υπάρχουν κωδικοί</p></div>}
      </div>

      <h2 className="sa-section-title" style={{ marginTop: 24 }}>Διεκδικήσεις</h2>
      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr><th>Θέση</th><th>Εταιρία</th><th>Κωδικός</th><th>Ημερομηνία</th></tr>
          </thead>
          <tbody>
            {view.claims.map((c) => (
              <tr key={c.slot} className="sa-table-row">
                <td className="sa-num">#{c.slot}</td>
                <td>{c.tenantName ?? "(διαγραμμένη εταιρία)"}</td>
                <td>{c.codeLabel || "—"}</td>
                <td className="sa-date">{new Date(c.claimedAt).toLocaleDateString("el-GR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="sa-section-title" style={{ marginTop: 24 }}>Ειδοποιήσεις λήξης έκπτωσης (30 ημέρες πριν)</h2>
      {view.notices.length === 0 ? (
        <p className="sa-founding-note">Καμία δεν οφείλεται τώρα.</p>
      ) : (
        view.notices.map((n) => (
          <div key={n.tenantId} className="sa-settings-card">
            <h3>{n.tenantName} · λήξη {new Date(n.endsAt).toLocaleDateString("el-GR")}</h3>
            <p className="sa-founding-note">
              Μόνο κείμενο: η αποστολή σε πελάτες θέλει επαληθευμένο domain στο Resend.
            </p>
            <pre className="sa-founding-pre">{n.subject}{"\n\n"}{n.text}</pre>
          </div>
        ))
      )}
    </>
  );
}

// ─── Γνώμες εταιριών (SQL 36) ─────────────

interface FeedbackItem {
  id: string;
  tenantName: string | null;
  userName: string | null;
  helpedMost: string | null;
  missing: string | null;
  vehicleCount: number | null;
  createdAt: string;
}

function FeedbackAdminView() {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/super-admin/feedback")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) setItems(d.data.items);
        else setError(d.message || "Σφάλμα");
      })
      .catch(() => setError("Σφάλμα σύνδεσης"));
  }, []);
  return (
    <>
      <div className="sa-toolbar">
        <h1 className="sa-page-title">Γνώμες εταιριών</h1>
        <span className="sa-count">{items?.length ?? 0}</span>
      </div>
      {error && <div className="sa-load-error">{error}</div>}
      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr><th>Εταιρία</th><th>Τι βοήθησε</th><th>Τι έλειψε</th><th>Οχήματα</th><th>Ημερομηνία</th></tr>
          </thead>
          <tbody>
            {(items ?? []).map((f) => (
              <tr key={f.id} className="sa-table-row">
                <td>{f.tenantName ?? "—"}<div className="sa-tenant-slug">{f.userName ?? ""}</div></td>
                <td className="sa-feedback-text">{f.helpedMost ?? "—"}</td>
                <td className="sa-feedback-text">{f.missing ?? "—"}</td>
                <td className="sa-num">{f.vehicleCount ?? "—"}</td>
                <td className="sa-date">{new Date(f.createdAt).toLocaleDateString("el-GR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items && items.length === 0 && <div className="sa-empty"><p>Καμία γνώμη ακόμα</p></div>}
      </div>
    </>
  );
}

// ─── Platform Settings View ───────────────

function PlatformSettingsView() {
  return (
    <div className="sa-settings-grid">
      <MyPasswordCard />

      <div className="sa-settings-card">
        <h3>Στοιχεία Πλατφόρμας</h3>
        <div className="sa-form-grid">
          <label>Όνομα Πλατφόρμας<input defaultValue="FleetPro" /></label>
          <label>Email Επικοινωνίας<input defaultValue="support@fleetpro.gr" /></label>
          <label>URL Πλατφόρμας<input defaultValue="https://fleetpro.gr" /></label>
        </div>
        <button className="sa-btn-primary" style={{ marginTop: 16 }}>
          Αποθήκευση
        </button>
      </div>

      <div className="sa-settings-card">
        <h3>Τιμές Συνδρομών</h3>
        {(["STARTER", "PRO", "ENTERPRISE"] as SubscriptionPlan[]).map(
          (plan) => (
            <div key={plan} className="sa-price-row">
              <span className={`sa-plan-badge ${plan.toLowerCase()}`}>
                {PLAN_LABELS[plan]}
              </span>
              <input
                type="number"
                defaultValue={PLAN_PRICES[plan]}
                className="sa-price-input"
              />
              <span>€/μήνα</span>
            </div>
          )
        )}
        <button className="sa-btn-primary" style={{ marginTop: 16 }}>
          Ενημέρωση Τιμών
        </button>
      </div>

      <div className="sa-settings-card">
        <h3>Δοκιμαστική Περίοδος</h3>
        <label className="sa-label">
          Διάρκεια Trial (ημέρες)
          <input type="number" defaultValue={14} />
        </label>
        <label className="sa-label">
          Μέγιστα Οχήματα σε Trial
          <input type="number" defaultValue={5} />
        </label>
        <button className="sa-btn-primary" style={{ marginTop: 16 }}>
          Αποθήκευση
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Αλλαγή του δικού μου κωδικού
   ───────────────────────────────────────────── */

function MyPasswordCard() {
  // Και τα τρία πεδία ξεκινούν κενά και καθαρίζουν μετά την αποθήκευση:
  // κανένας κωδικός δεν μένει στη μνήμη της σελίδας περισσότερο από όσο
  // χρειάζεται για το ένα request.
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsCurrent = next.length > 0 && next === current;
  const valid =
    current.length > 0 && next.length >= 8 && next === confirm && !sameAsCurrent;

  const submit = async () => {
    if (!valid || saving) return;

    setSaving(true);
    setError("");
    setDone(false);

    try {
      const res = await fetch("/api/users/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Δεν ήταν δυνατή η αλλαγή");
        return;
      }

      setCurrent("");
      setNext("");
      setConfirm("");
      setShow(false);
      setDone(true);
    } catch {
      setError("Σφάλμα σύνδεσης");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sa-settings-card">
      <h3>Ο κωδικός μου</h3>
      <p className="sa-muted-note">
        Αλλαγή του κωδικού του λογαριασμού με τον οποίο είσαι συνδεδεμένος.
      </p>

      {done && (
        <div className="sa-ok-banner">
          <CheckCircle size={15} /> Ο κωδικός σου άλλαξε.
        </div>
      )}

      <label className="sa-label">
        Τρέχων κωδικός
        <div className="sa-password-wrap">
          <input
            type={show ? "text" : "password"}
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setDone(false);
            }}
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? "Απόκρυψη" : "Εμφάνιση"}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>

      <label className="sa-label">
        Νέος κωδικός
        <input
          type={show ? "text" : "password"}
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
            setDone(false);
          }}
          autoComplete="new-password"
          placeholder="Τουλάχιστον 8 χαρακτήρες"
        />
      </label>

      <label className="sa-label">
        Επιβεβαίωση νέου κωδικού
        <input
          type={show ? "text" : "password"}
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setDone(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoComplete="new-password"
        />
      </label>

      {tooShort && (
        <div className="sa-error">
          Ο νέος κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες
        </div>
      )}
      {sameAsCurrent && !tooShort && (
        <div className="sa-error">
          Ο νέος κωδικός είναι ίδιος με τον τρέχοντα
        </div>
      )}
      {mismatch && (
        <div className="sa-error">Οι δύο κωδικοί δεν ταιριάζουν</div>
      )}
      {error && <div className="sa-error">{error}</div>}

      <button
        className="sa-btn-primary"
        style={{ marginTop: 16 }}
        onClick={submit}
        disabled={!valid || saving}
      >
        {saving ? "Αποθήκευση…" : "Αλλαγή κωδικού"}
      </button>
    </div>
  );
}

// ─── Create Tenant Modal ──────────────────

function CreateTenantModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (tenant: Tenant) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    slug: "",
    email: "",
    phone: "",
    plan: "STARTER" as SubscriptionPlan,
    planKey: "full" as string | null,
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    setForm((f) => ({ ...f, name, slug }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Σφάλμα δημιουργίας");
        return;
      }

      onSuccess(data.data.tenant);
    } catch {
      setError("Σφάλμα σύνδεσης");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sa-modal-overlay" onClick={onClose}>
      <div className="sa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h2>Νέα Εταιρία Πελάτης</h2>
          <button className="sa-modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="sa-modal-body">
          <div className="sa-section-title">Στοιχεία Εταιρίας</div>
          <div className="sa-form-grid">
            <label>
              Επωνυμία *
              <input
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="π.χ. Fleet-Pro Car Rental"
              />
            </label>
            <label>
              Slug (subdomain) *
              <div className="sa-slug-wrap">
                <input
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, slug: e.target.value }))
                  }
                  placeholder="p-rentals"
                />
                <span>.fleetpro.gr</span>
              </div>
            </label>
            <label>
              Email Επικοινωνίας *
              <input
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="info@company.gr"
              />
            </label>
            <label>
              Τηλέφωνο
              <input
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
                placeholder="2810000000"
              />
            </label>
            <label>
              Πλάνο Συνδρομής
              <select
                value={form.plan}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    plan: e.target.value as SubscriptionPlan,
                  }))
                }
              >
                <option value="STARTER">Starter — 49€/μήνα</option>
                <option value="PRO">Pro — 129€/μήνα</option>
                <option value="ENTERPRISE">Enterprise — 299€/μήνα</option>
              </select>
            </label>
            <label>
              Πακέτο (λειτουργίες)
              <PlanKeySelect
                value={form.planKey}
                onChange={(planKey) => setForm((f) => ({ ...f, planKey: planKey ?? "full" }))}
              />
            </label>
          </div>

          <div className="sa-section-title" style={{ marginTop: 20 }}>
            Διαχειριστής Εταιρίας
          </div>
          <div className="sa-form-grid">
            <label>
              Ονοματεπώνυμο *
              <input
                value={form.adminName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, adminName: e.target.value }))
                }
                placeholder="Γιάννης Παπαδόπουλος"
              />
            </label>
            <label>
              Email Διαχειριστή *
              <input
                type="email"
                value={form.adminEmail}
                onChange={(e) =>
                  setForm((f) => ({ ...f, adminEmail: e.target.value }))
                }
                placeholder="admin@company.gr"
              />
            </label>
            <label>
              Κωδικός Πρόσβασης *
              <div className="sa-password-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.adminPassword}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, adminPassword: e.target.value }))
                  }
                  placeholder="Τουλάχιστον 8 χαρακτήρες"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          </div>

          {error && <div className="sa-error">{error}</div>}
        </div>

        <div className="sa-modal-footer">
          <button className="sa-btn-ghost" onClick={onClose}>
            Ακύρωση
          </button>
          <button
            className="sa-btn-primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "Δημιουργία..." : "Δημιουργία Εταιρίας"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Πακέτα (entitlements) ────────────────
// Οι τιμές (ενότητες/όρια) αλλάζουν στη βάση (πίνακας plans)· εδώ μόνο η
// ανάθεση πακέτου σε εταιρία.

interface PlanOption {
  key: string;
  name: string;
  active: boolean;
}

function usePlans(): PlanOption[] {
  const [plans, setPlans] = useState<PlanOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/plans")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.data?.plans) setPlans(d.data.plans);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return plans;
}

function PlanKeySelect({
  value,
  onChange,
  allowNone,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  allowNone?: boolean;
}) {
  const plans = usePlans();
  // Ανενεργό πακέτο δεν προσφέρεται — εκτός αν το έχει ήδη η εταιρία.
  const options = plans.filter((p) => p.active || p.key === value);
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">— Χωρίς πακέτο —</option>}
      {value && !options.some((p) => p.key === value) && <option value={value}>{value}</option>}
      {options.map((p) => (
        <option key={p.key} value={p.key}>
          {p.name} ({p.key})
        </option>
      ))}
    </select>
  );
}

// ─── Edit Tenant Modal ────────────────────

function EditTenantModal({
  tenant,
  onClose,
  onSuccess,
  onDelete,
}: {
  tenant: Tenant;
  onClose: () => void;
  onSuccess: (t: Tenant) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState({
    name: tenant.name,
    email: tenant.email,
    phone: tenant.phone || "",
    plan: tenant.plan,
    planKey: tenant.planKey,
    status: tenant.status,
    brandColor: tenant.brandColor,
    website: "",
    // % με έως 2 δεκαδικά (π.χ. «1,5») ↔ basis points στη βάση.
    platformFee: String((tenant.platformFeeBps ?? 0) / 100).replace(".", ","),
    // Συνδρομή (SQL 36): χειροκίνητα μόνο οι καταστάσεις πριν από το Stripe.
    billingStatus: tenant.billingStatus ?? "exempt",
    trialEndsOn: tenant.trialEndsAt ? tenant.trialEndsAt.slice(0, 10) : "",
  });
  const stripeManaged = !["exempt", "founder_trial", "awaiting_checkout"].includes(tenant.billingStatus ?? "exempt");
  const [loading, setLoading] = useState(false);
  const feeBps = Math.round(Number(form.platformFee.trim().replace(",", ".") || "0") * 100);
  const feeValid = Number.isInteger(feeBps) && feeBps >= 0 && feeBps <= 5000;

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Το website δεν φορτώνεται στη φόρμα: κενό = «δεν αλλάζει». Το domain
      // του site το ορίζει ο Admin της εταιρίας («Η σελίδα μου» → «Domain»).
      const { website, platformFee: _fee, billingStatus, trialEndsOn, ...rest } = form;
      const payload = {
        ...rest,
        platformFeeBps: feeBps,
        ...(website.trim() && { website: website.trim() }),
        // Με συνδρομή στο Stripe η κατάσταση/δοκιμή έρχονται ΜΟΝΟ από το Stripe.
        ...(!stripeManaged && {
          billingStatus,
          ...(trialEndsOn !== (tenant.trialEndsAt ? tenant.trialEndsAt.slice(0, 10) : "") && { trialEndsOn: trialEndsOn || null }),
        }),
      };
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        onSuccess({ ...tenant, ...data.data });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sa-modal-overlay" onClick={onClose}>
      <div className="sa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h2>Επεξεργασία: {tenant.name}</h2>
          <button className="sa-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="sa-modal-body">
          <div className="sa-form-grid">
            <label>Επωνυμία<input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} /></label>
            <label>Email<input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} /></label>
            <label>Τηλέφωνο<input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} /></label>
            <label>Πλάνο
              <select value={form.plan} onChange={e => setForm(f => ({...f, plan: e.target.value as SubscriptionPlan}))}>
                <option value="STARTER">Starter</option>
                <option value="PRO">Pro</option>
                <option value="ENTERPRISE">Business</option>
              </select>
            </label>
            <label>Πακέτο (λειτουργίες)
              <PlanKeySelect value={form.planKey} onChange={(planKey) => setForm(f => ({...f, planKey}))} allowNone />
            </label>
            <label>Κατάσταση
              <select value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value as TenantStatus}))}>
                <option value="TRIAL">Δοκιμαστική</option>
                <option value="ACTIVE">Ενεργή</option>
                <option value="SUSPENDED">Ανασταλμένη</option>
                <option value="CANCELLED">Ακυρωμένη</option>
              </select>
            </label>
            <label>Χρώμα Brand
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <input type="color" value={form.brandColor} onChange={e => setForm(f => ({...f, brandColor: e.target.value}))} style={{width:40,height:36,padding:2,borderRadius:6}} />
                <input value={form.brandColor} onChange={e => setForm(f => ({...f, brandColor: e.target.value}))} />
              </div>
            </label>
            <label>Website (embed)<input value={form.website} onChange={e => setForm(f => ({...f, website: e.target.value}))} placeholder="https://mycompany.gr" /></label>
            <label>Συνδρομή
              <select value={form.billingStatus} disabled={stripeManaged} onChange={e => setForm(f => ({...f, billingStatus: e.target.value}))}>
                {stripeManaged && <option value={form.billingStatus}>{BILLING_LABELS[form.billingStatus] ?? form.billingStatus} (Stripe)</option>}
                <option value="exempt">Εκτός χρέωσης</option>
                <option value="founder_trial">Δοκιμή ιδρυτή (χωρίς κάρτα)</option>
                <option value="awaiting_checkout">Αναμονή κάρτας (Checkout)</option>
              </select>
              <small>
                {stripeManaged
                  ? "Η συνδρομή είναι στο Stripe: αλλαγές από το Stripe (ή από την εταιρία στη «Διαχείριση συνδρομής»)."
                  : "Πλάνο συνδρομής = «Πακέτο»: Starter / Pro / Business (όρια από τη βάση)."}
              </small>
            </label>
            <label>Λήξη δοκιμής
              <input type="date" value={form.trialEndsOn} disabled={stripeManaged} onChange={e => setForm(f => ({...f, trialEndsOn: e.target.value}))} />
              <small>Κενό = χωρίς ημερομηνία (δοκιμή ιδρυτή: ξεκινά με το πρώτο όχημα).</small>
            </label>
            <label>
              Προμήθεια πλατφόρμας στις online πληρωμές (%)
              <input inputMode="decimal" value={form.platformFee} onChange={e => setForm(f => ({...f, platformFee: e.target.value}))} placeholder="0" aria-invalid={!feeValid} />
              <small>0 = καμία προμήθεια. Έως 50%. Δεν τη βλέπει η εταιρία.</small>
            </label>
          </div>
        </div>
        <div className="sa-modal-footer">
          <button className="sa-btn-danger sa-footer-left" onClick={onDelete} data-testid="edit-tenant-delete">
            <Trash2 size={13} /> Διαγραφή εταιρίας
          </button>
          <button className="sa-btn-ghost" onClick={onClose}>Ακύρωση</button>
          <button className="sa-btn-primary" onClick={handleSubmit} disabled={loading || !feeValid}>
            {loading ? "Αποθήκευση..." : "Αποθήκευση"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Χρήστες εταιρίας — λίστα + reset κωδικού
   ───────────────────────────────────────────── */

function TenantUsersModal({
  tenant,
  onClose,
}: {
  tenant: Tenant;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState<TenantUser | null>(null);
  const [done, setDone] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/users?tenantId=${tenant.id}&limit=100`);
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setError(data.message || "Δεν ήταν δυνατή η φόρτωση των χρηστών");
          return;
        }
        setUsers(data.data.users);
      } catch {
        if (!cancelled) setError("Σφάλμα σύνδεσης");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenant.id]);

  return (
    <div className="sa-modal-overlay" onClick={onClose}>
      <div className="sa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h2>Χρήστες · {tenant.name}</h2>
          <button className="sa-modal-close" onClick={onClose}>
            <XCircle size={18} />
          </button>
        </div>

        <div className="sa-modal-body">
          {done && (
            <div className="sa-ok-banner">
              <CheckCircle size={15} /> {done}
            </div>
          )}

          {loading && <div className="sa-skeleton" />}
          {error && <div className="sa-error">{error}</div>}

          {!loading && !error && users.length === 0 && (
            <p className="sa-muted-note">Η εταιρία δεν έχει χρήστες.</p>
          )}

          {!loading && !error && users.length > 0 && (
            <ul className="sa-user-list">
              {users.map((u) => {
                // Ο Super Admin δεν ρεσετάρεται από εδώ — το ίδιο επιβάλλει
                // και ο server, αυτό είναι μόνο για να μη μπερδεύει το UI.
                const canReset = u.role !== "SUPER_ADMIN";
                return (
                  <li key={u.id} className="sa-user-row">
                    <div className="sa-user-main">
                      <span className="sa-user-row-name">
                        {u.name}
                        {!u.isActive && (
                          <span className="sa-user-off">ανενεργός</span>
                        )}
                      </span>
                      <span className="sa-user-row-email">{u.email}</span>
                    </div>
                    <span className="sa-role-badge">{ROLE_LABELS[u.role]}</span>
                    <button
                      className="sa-btn-ghost"
                      onClick={() => {
                        setDone("");
                        setResetting(u);
                      }}
                      disabled={!canReset}
                      title={
                        canReset
                          ? "Ορισμός νέου κωδικού"
                          : "Δεν επιτρέπεται reset σε Super Admin"
                      }
                    >
                      <Shield size={12} /> Reset κωδικού
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="sa-modal-footer">
          <button className="sa-btn-ghost" onClick={onClose}>
            Κλείσιμο
          </button>
        </div>
      </div>

      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onSuccess={(name) => {
            setDone(`Ο κωδικός του χρήστη ${name} άλλαξε.`);
            setResetting(null);
          }}
        />
      )}
    </div>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onSuccess,
}: {
  user: TenantUser;
  onClose: () => void;
  onSuccess: (name: string) => void;
}) {
  // Τα πεδία ξεκινούν ΠΑΝΤΑ κενά: ο υπάρχων κωδικός δεν υπάρχει σε καθαρή
  // μορφή πουθενά και δεν φτάνει ποτέ στον browser.
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= 8 && password === confirm;

  const submit = async () => {
    if (!valid || saving) return;

    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/users/${user.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Δεν ήταν δυνατή η αλλαγή");
        return;
      }

      onSuccess(user.name);
    } catch {
      setError("Σφάλμα σύνδεσης");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sa-modal-overlay" onClick={(e) => e.stopPropagation()}>
      <div
        className="sa-modal sa-modal--sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sa-modal-header">
          <h2>Νέος κωδικός</h2>
          <button className="sa-modal-close" onClick={onClose}>
            <XCircle size={18} />
          </button>
        </div>

        <div className="sa-modal-body">
          <p className="sa-muted-note">
            {user.name} · {user.email}
          </p>

          <label className="sa-label">
            Νέος κωδικός
            <div className="sa-password-wrap">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Τουλάχιστον 8 χαρακτήρες"
              />
              <button
                type="button"
                className="sa-eye"
                onClick={() => setShow(!show)}
                aria-label={show ? "Απόκρυψη" : "Εμφάνιση"}
              >
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>

          <label className="sa-label">
            Επιβεβαίωση
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoComplete="new-password"
            />
          </label>

          {tooShort && (
            <div className="sa-error">
              Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες
            </div>
          )}
          {mismatch && (
            <div className="sa-error">Οι δύο κωδικοί δεν ταιριάζουν</div>
          )}
          {error && <div className="sa-error">{error}</div>}

          <p className="sa-muted-note">
            Δώσε τον νέο κωδικό στον χρήστη με ασφαλή τρόπο. Δεν εμφανίζεται
            ξανά μετά την αποθήκευση.
          </p>
        </div>

        <div className="sa-modal-footer">
          <button className="sa-btn-ghost" onClick={onClose} disabled={saving}>
            Άκυρο
          </button>
          <button
            className="sa-btn-primary"
            onClick={submit}
            disabled={!valid || saving}
          >
            {saving ? "Αποθήκευση…" : "Αλλαγή κωδικού"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────

const superAdminStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .sa-root {
    display: flex;
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', sans-serif;
    font-size: 13px;
  }

  /* ── Sidebar ── */
  .sa-sidebar {
    width: 220px;
    min-height: 100vh;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow: hidden;
  }

  .sa-logo {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 20px 16px 16px;
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }

  .sa-logo-icon { color: var(--primary); }

  .sa-badge {
    font-size: 9px;
    font-weight: 600;
    background: var(--primary);
    color: #fff;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-left: auto;
  }

  .sa-nav {
    padding: 12px 8px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sa-nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border-radius: 8px;
    background: none;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-size: 13px;
    transition: all 0.15s;
  }

  .sa-nav-item:hover { background: var(--border); color: var(--text); }
  .sa-nav-item.active { background: var(--primary-bg); color: var(--primary-soft); font-weight: 600; }

  /* ── Main ── */
  .sa-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    /* clip (όχι hidden): δεν γίνεται «scroll container», άρα η μπάρα του
       κινητού μένει πραγματικά sticky. */
    overflow: clip;
  }

  /* ── Stats Bar ── */
  .sa-stats-bar {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .sa-stat-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-right: 1px solid var(--border);
  }
  .sa-stat-card:last-child { border-right: none; }

  .sa-stat-icon {
    width: 32px; height: 32px;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }

  .sa-stat-value { font-size: 18px; font-weight: 700; color: var(--text); line-height: 1; }
  .sa-stat-label { font-size: 10px; color: var(--text-4); margin-top: 2px; }

  /* ── Content ── */
  .sa-content {
    flex: 1;
    padding: 20px 24px;
    overflow-y: auto;
  }

  .sa-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }

  .sa-toolbar-left { display: flex; align-items: center; gap: 10px; flex: 1; }
  .sa-toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  .sa-page-title { font-size: 18px; font-weight: 700; color: var(--text); }
  .sa-count {
    background: var(--border);
    color: var(--text-3);
    padding: 2px 8px;
    border-radius: 100px;
    font-size: 11px;
    font-weight: 600;
  }

  .sa-search {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--hover);
    border: 1px solid var(--hover-2);
    border-radius: 8px;
    padding: 6px 10px;
    color: var(--text-4);
  }
  .sa-search input {
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 12px;
    width: 160px;
  }
  .sa-search input::placeholder { color: var(--text-4); }

  .sa-select {
    background: var(--hover);
    border: 1px solid var(--hover-2);
    border-radius: 8px;
    padding: 6px 10px;
    color: var(--text);
    font-size: 12px;
    outline: none;
    cursor: pointer;
  }

  .sa-btn-primary {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--primary);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .sa-btn-primary:hover { background: var(--primary-hover); }
  .sa-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .sa-btn-ghost {
    background: var(--hover);
    border: 1px solid var(--hover-2);
    color: var(--text-3);
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .sa-btn-ghost:hover { background: var(--hover-2); color: var(--text); }

  /* ── Table ── */
  .sa-table-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    border-radius: 12px;
    /* ΟΧΙ overflow: hidden — έκοβε το dropdown ενεργειών της γραμμής.
       Οι στρογγυλεμένες γωνίες γίνονται στα ακραία κελιά παρακάτω. */
  }

  .sa-table { width: 100%; border-collapse: collapse; }

  /* Αντικαθιστά το clipping που έκανε το overflow: hidden. */
  .sa-table thead tr:first-child th:first-child { border-top-left-radius: 11px; }
  .sa-table thead tr:first-child th:last-child { border-top-right-radius: 11px; }
  .sa-table tbody tr:last-child td:first-child { border-bottom-left-radius: 11px; }
  .sa-table tbody tr:last-child td:last-child { border-bottom-right-radius: 11px; }

  .sa-table th {
    text-align: left;
    padding: 10px 14px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-3);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }

  .sa-table-row {
    border-bottom: 1px solid var(--border);
    transition: background 0.1s;
  }
  /* Η γραμμή με ανοιχτό μενού μπαίνει μπροστά από τις επόμενες. */
  .sa-table-row:has(.sa-dropdown) { position: relative; z-index: 60; }
  .sa-table-row:hover { background: var(--hover); }
  .sa-table-row:last-child { border-bottom: none; }

  .sa-table td { padding: 12px 14px; vertical-align: middle; }

  .sa-tenant-cell { display: flex; align-items: center; gap: 10px; }
  .sa-tenant-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .sa-tenant-name { font-weight: 600; color: var(--text); font-size: 13px; }
  .sa-tenant-slug { font-size: 10px; color: var(--text-4); font-family: 'JetBrains Mono', monospace; }

  .sa-plan-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 100px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .sa-plan-badge.starter { background: var(--blue-bg); color: var(--blue-fg); }
  .sa-plan-badge.pro { background: var(--violet-bg); color: var(--violet-fg); }
  .sa-plan-badge.enterprise { background: #1a1a1a; color: #f8fafc; border: 1px solid #334155; }

  .sa-status-wrap { display: flex; align-items: center; gap: 6px; flex-direction: column; align-items: flex-start; }
  .sa-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 100px;
    font-size: 10px;
    font-weight: 600;
  }

  .sa-trial-days { font-size: 9px; color: var(--warn-icon); font-weight: 600; }
  .sa-source { font-size: 12px; color: var(--text-3); }
  .sa-trial-expired { font-size: 9px; color: var(--bad-icon); font-weight: 600; }

  .sa-num { color: var(--text-3); font-weight: 600; font-size: 13px; }
  .sa-date { color: var(--text-4); font-size: 11px; }

  .sa-actions { display: flex; align-items: center; gap: 4px; }
  .sa-icon-btn {
    background: none;
    border: none;
    color: var(--text-4);
    cursor: pointer;
    padding: 5px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.1s;
  }
  .sa-icon-btn:hover { background: var(--border); color: var(--text-3); }

  .sa-menu-wrap { position: relative; }
  .sa-dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 4px;
    /* Πάνω από τις γραμμές και τη sticky κεφαλίδα, κάτω από τα modals (100). */
    z-index: 60;
    min-width: 170px;
    box-shadow: var(--shadow-dropdown);
  }
  /* Όταν δεν χωράει από κάτω στο ορατό παράθυρο, ανοίγει προς τα πάνω. */
  .sa-dropdown.up { top: auto; bottom: calc(100% + 4px); }
  .sa-dropdown button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    border-radius: 7px;
    font-size: 12px;
    text-align: left;
    transition: all 0.1s;
  }
  .sa-dropdown button:hover { background: var(--hover-2); color: var(--text); }
  .sa-dropdown button.danger { color: var(--bad-fg); }
  .sa-dropdown button.danger:hover { background: var(--bad-bg); }

  .sa-empty {
    text-align: center;
    padding: 60px;
    color: var(--text-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .sa-loading { display: flex; flex-direction: column; gap: 8px; }
  .sa-skeleton {
    height: 52px;
    background: linear-gradient(90deg, var(--hover), var(--hover-2), var(--hover));
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 8px;
  }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

  /* ── Code ── */
  .sa-code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    background: var(--hover);
    border: 1px solid var(--hover-2);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--primary-soft);
  }

  /* ── Stats Grid ── */
  .sa-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }

  .sa-stats-card {
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    border-radius: 12px;
    padding: 20px;
  }

  .sa-stats-card h3 { font-size: 13px; font-weight: 600; color: var(--text-3); margin-bottom: 16px; }

  .sa-plan-dist { display: flex; flex-direction: column; gap: 12px; }
  .sa-plan-dist-row { display: flex; align-items: center; gap: 10px; }
  .sa-plan-bar-wrap { flex: 1; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .sa-plan-bar { height: 100%; background: var(--primary); border-radius: 2px; transition: width 0.5s; }
  .sa-plan-count { font-size: 11px; font-weight: 600; color: var(--text-3); min-width: 16px; text-align: right; }

  .sa-mrr { display: flex; align-items: baseline; gap: 4px; margin-bottom: 16px; }
  .sa-mrr-value { font-size: 36px; font-weight: 800; color: var(--text); }
  .sa-mrr-label { font-size: 12px; color: var(--text-4); }
  .sa-mrr-breakdown { display: flex; flex-direction: column; gap: 8px; }
  .sa-mrr-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-4); }
  .sa-mrr-row strong { color: var(--text); }

  .sa-status-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .sa-status-count { font-size: 16px; font-weight: 700; color: var(--text); }

  /* ── Settings ── */
  .sa-settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .sa-settings-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .sa-settings-card h3 { font-size: 13px; font-weight: 600; color: var(--text-3); margin-bottom: 16px; }
  .sa-price-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .sa-price-input { width: 80px; }
  .sa-label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; color: var(--text-4); font-size: 11px; }

  /* ── Modal ── */
  .sa-modal-overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    backdrop-filter: blur(4px);
  }

  .sa-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    width: 560px;
    max-width: 95vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-modal);
  }

  .sa-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
  }
  .sa-modal-header h2 { font-size: 16px; font-weight: 700; color: var(--text); }

  .sa-modal-close {
    background: none;
    border: none;
    color: var(--text-4);
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.1s;
  }
  .sa-modal-close:hover { background: var(--border); color: var(--text); }

  .sa-modal-body { padding: 24px; overflow-y: auto; flex: 1; }
  .sa-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 24px;
    border-top: 1px solid var(--border);
  }

  .sa-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-4); margin-bottom: 12px; }

  .sa-form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .sa-form-grid label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 11px;
    color: var(--text-4);
    font-weight: 500;
  }

  .sa-form-grid input,
  .sa-form-grid select {
    background: var(--hover);
    border: 1px solid var(--hover-2);
    border-radius: 8px;
    padding: 8px 10px;
    color: var(--text);
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
    font-family: inherit;
  }
  .sa-form-grid input:focus,
  .sa-form-grid select:focus { border-color: var(--primary); }

  .sa-slug-wrap { position: relative; display: flex; align-items: center; }
  .sa-slug-wrap input { flex: 1; padding-right: 80px; }
  .sa-slug-wrap span { position: absolute; right: 8px; font-size: 10px; color: var(--text-4); pointer-events: none; }

  .sa-password-wrap { position: relative; display: flex; align-items: center; }
  .sa-password-wrap input { flex: 1; padding-right: 36px; }
  .sa-password-wrap button {
    position: absolute; right: 8px;
    background: none; border: none; color: var(--text-4); cursor: pointer;
    display: flex; align-items: center;
  }

  .sa-error {
    margin-top: 12px;
    padding: 10px 12px;
    background: var(--bad-bg);
    border: 1px solid var(--bad-border);
    border-radius: 8px;
    color: var(--bad-fg);
    font-size: 12px;
  }

  /* ── Χρήστες εταιρίας + reset κωδικού ── */
  .sa-ok-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    padding: 10px 12px;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 8px;
    color: var(--ok-fg);
    font-size: 12px;
    font-weight: 600;
  }

  .sa-muted-note { color: var(--text-4); font-size: 12px; margin-bottom: 14px; }

  /* ── Εκπτώσεις συνδρομών ── */
  .sa-pd-error { margin: 0 0 14px; }
  .sa-pd-note { color: var(--text-3); font-size: 12px; max-width: 220px; }
  .sa-pd-price { font-size: 12px; color: var(--text-3); white-space: nowrap; }
  .sa-pd-price s { color: var(--text-4); }
  .sa-pd-active { color: var(--ok-fg); background: rgba(34, 197, 94, 0.1); }
  .sa-pd-scheduled { color: var(--warn-fg); background: rgba(245, 158, 11, 0.12); }
  .sa-pd-expired { color: var(--text-4); background: var(--hover); }
  .sa-pd-inactive { color: var(--bad-fg); background: var(--bad-bg); }
  .sa-pd-danger:hover { color: var(--bad-fg); }
  .sa-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .sa-form-grid .sa-pd-full { grid-column: 1 / -1; }
  .sa-form-grid .sa-pd-check { flex-direction: row; align-items: center; gap: 8px; font-size: 12px; color: var(--text); }
  .sa-pd-preview {
    margin-top: 14px;
    padding: 10px 12px;
    background: var(--blue-bg);
    color: var(--blue-fg);
    border-radius: 8px;
    font-size: 12px;
  }

  .sa-user-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .sa-user-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 11px 13px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .sa-user-main { flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 2px; }
  .sa-user-row-name {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .sa-user-row-email {
    font-size: 11px;
    color: var(--text-4);
    font-family: 'JetBrains Mono', monospace;
  }
  .sa-user-off {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--bad-bg);
    color: var(--bad-fg);
  }
  .sa-role-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 3px 8px;
    border-radius: 100px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-3);
    white-space: nowrap;
  }
  .sa-user-row .sa-btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }

  .sa-load-error {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 16px;
    padding: 11px 13px;
    background: var(--bad-bg);
    border: 1px solid var(--bad-border);
    border-radius: 9px;
    color: var(--bad-fg);
    font-size: 12.5px;
    font-weight: 600;
  }

  .sa-modal--sm { width: 440px; }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--hover-2); border-radius: 2px; }

  /* ── Responsive ── */
  @media (max-width: 900px) {
    .sa-stats-bar { grid-template-columns: repeat(3, 1fr); }
    .sa-form-grid { grid-template-columns: 1fr; }
  }
  .sa-mobile-bar { display: none; }
  @media (max-width: 768px) {
    .sa-sidebar { display: none; }
    .sa-mobile-bar {
      display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px;
      padding: 10px 16px 0; border-bottom: 1px solid var(--border); background: var(--surface);
      /* Αποσύνδεση και ενότητες πάντα ορατές στο κινητό, και με κύλισμα. */
      position: sticky; top: 0; z-index: 20;
    }
    .sa-mobile-brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: var(--text); }
    .sa-mobile-tabs {
      flex: 1 0 100%; display: flex; gap: 4px; overflow-x: auto; overscroll-behavior-x: contain;
      -webkit-overflow-scrolling: touch; scrollbar-width: none; margin: 0 -16px; padding: 0 16px 8px;
    }
    .sa-mobile-tabs::-webkit-scrollbar { display: none; }
    .sa-mobile-tab {
      flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; min-height: 36px;
      padding: 7px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface);
      color: var(--text-3); font: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer;
    }
    .sa-mobile-tab.active { background: var(--primary-bg); border-color: var(--primary); color: var(--primary-soft); font-weight: 700; }
  }
  @media (max-width: 600px) {
    .sa-stats-bar { grid-template-columns: repeat(2, 1fr); }
  }

  .sa-founding-strip { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--text-3); margin: 0 0 14px; }
  .sa-founding-strip strong { color: var(--text); }
  .sa-founding-code { margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: var(--primary-bg); font-size: 13px; }
  .sa-founding-code code { font-size: 15px; font-weight: 700; letter-spacing: 1px; user-select: all; }
  .sa-founding-note { font-size: 12.5px; color: var(--text-4); margin: 4px 0 10px; }
  .sa-founding-pre { white-space: pre-wrap; font-size: 12.5px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin: 0; }
  .sa-feedback-text { max-width: 320px; white-space: pre-wrap; font-size: 12.5px; }

  /* Οριστική διαγραφή εταιρίας */
  .sa-btn-danger {
    display: inline-flex; align-items: center; gap: 6px; min-height: 36px;
    background: var(--danger-btn); color: #fff; border: none; border-radius: 8px;
    padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .sa-btn-danger:hover:not(:disabled) { background: var(--danger-btn-hover); }
  .sa-btn-danger:disabled { opacity: 0.45; cursor: not-allowed; }
  .sa-footer-left { margin-right: auto; }
  .sa-delete-warn { font-size: 13px; color: var(--text); margin: 0 0 8px; line-height: 1.5; }
  .sa-delete-list { margin: 0 0 12px; padding-left: 18px; font-size: 13px; color: var(--text-2); display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
  .sa-delete-check { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; color: var(--text); margin: 12px 0; }
  .sa-delete-confirm { margin-top: 12px; font-size: 12px; color: var(--text-3); }
  .sa-delete-confirm input {
    margin-top: 6px; width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--bg); color: var(--text); font-size: 15px; font-family: inherit;
  }
  @media (max-width: 768px) {
    /* Πίνακες: οριζόντιο κύλισμα ΜΕΣΑ στο πλαίσιο (το .sa-main κόβει ό,τι βγαίνει έξω)
       και η στήλη ενεργειών (⋮) κολλημένη δεξιά — πάντα ορατή. */
    .sa-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .sa-table-row td:last-child, .sa-table thead th:last-child {
      position: sticky; right: 0; background: var(--surface); box-shadow: -6px 0 8px -6px rgba(0,0,0,.15);
    }
    /* Το μενού ενεργειών ως φύλλο στο κάτω μέρος της οθόνης (δεν κόβεται από το κύλισμα). */
    .sa-dropdown, .sa-dropdown.up {
      position: fixed; left: 12px; right: 12px; bottom: 12px; top: auto; min-width: 0; z-index: 90;
    }
    .sa-dropdown button { min-height: 44px; font-size: 14px; }
    .sa-modal-footer { flex-wrap: wrap; }
  }

  .sa-testclock { margin-left: 6px; background: var(--warn-fg); color: #fff; }
  .sa-full-charge { display: block; margin-top: 4px; font-size: 11px; white-space: normal; max-width: 220px; }
`;
