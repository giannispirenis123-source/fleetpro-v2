// src/app/(super-admin)/super-admin/page.tsx
// Super Admin Dashboard — διαχείριση όλης της πλατφόρμας

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  LogOut,
  ChevronDown,
  Activity,
  Zap,
} from "lucide-react";

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
  brandColor: string;
  logoUrl?: string;
  trialEndsAt?: string;
  createdAt: string;
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

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  STARTER: "Starter",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
};

const PLAN_PRICES: Record<SubscriptionPlan, number> = {
  STARTER: 49,
  PRO: 129,
  ENTERPRISE: 299,
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
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<TenantStatus | "ALL">("ALL");
  const [filterPlan, setFilterPlan] = useState<SubscriptionPlan | "ALL">("ALL");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [showTenantMenu, setShowTenantMenu] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  // Εταιρία της οποίας βλέπουμε τους χρήστες (λίστα + reset κωδικού).
  const [usersOfTenant, setUsersOfTenant] = useState<Tenant | null>(null);
  const [activeTab, setActiveTab] = useState<
    "tenants" | "stats" | "discounts" | "settings"
  >("tenants");

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
    return matchSearch && matchStatus && matchPlan;
  });

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
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

        <nav className="sa-nav">
          {[
            {
              id: "tenants",
              label: "Εταιρίες",
              icon: <Building2 size={16} />,
            },
            { id: "stats", label: "Στατιστικά", icon: <BarChart3 size={16} /> },
            {
              id: "discounts",
              label: "Εκπτώσεις",
              icon: <Tag size={16} />,
            },
            {
              id: "settings",
              label: "Ρυθμίσεις",
              icon: <Shield size={16} />,
            },
          ].map((item) => (
            <button
              key={item.id}
              className={`sa-nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => setActiveTab(item.id as typeof activeTab)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sa-sidebar-footer">
          <div className="sa-user-info">
            <div className="sa-user-avatar">SA</div>
            <div>
              <div className="sa-user-name">Super Admin</div>
              <div className="sa-user-email">admin@fleetpro.gr</div>
            </div>
          </div>
          <button className="sa-logout" onClick={handleLogout}>
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {/* ── Main Content ─────────────────── */}
      <main className="sa-main">
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
                value: `${stats.mrr}€`,
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
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
                <button
                  className="sa-btn-primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  <Plus size={14} />
                  Νέα Εταιρία
                </button>
              </div>
            </div>

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
                      <th>Κατάσταση</th>
                      <th>Οχήματα</th>
                      <th>Χρήστες</th>
                      <th>Κρατήσεις</th>
                      <th>Εγγραφή</th>
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
                        onStatusChange={(status) => {
                          setTenants((prev) =>
                            prev.map((t) =>
                              t.id === tenant.id ? { ...t, status } : t
                            )
                          );
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
            <div className="sa-toolbar">
              <h1 className="sa-page-title">Εκπτώσεις Πλατφόρμας</h1>
              <button className="sa-btn-primary">
                <Plus size={14} />
                Νέος Κωδικός
              </button>
            </div>
            <PlatformDiscountsView />
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

      {/* Edit Tenant Modal */}
      {selectedTenant && (
        <EditTenantModal
          tenant={selectedTenant}
          onClose={() => setSelectedTenant(null)}
          onSuccess={(updated) => {
            setTenants((prev) =>
              prev.map((t) => (t.id === updated.id ? updated : t))
            );
            setSelectedTenant(null);
          }}
        />
      )}

      <style>{superAdminStyles}</style>
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
}: {
  tenant: Tenant;
  showMenu: boolean;
  onMenuToggle: () => void;
  onEdit: () => void;
  onShowUsers: () => void;
  onStatusChange: (s: TenantStatus) => void;
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
      <td className="sa-date">
        {new Date(tenant.createdAt).toLocaleDateString("el-GR")}
      </td>
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
                <button className="danger">
                  <Trash2 size={12} /> Διαγραφή
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

function PlatformDiscountsView() {
  const mockCoupons = [
    {
      id: "1",
      code: "LAUNCH50",
      description: "Έκπτωση εγκαινίων 50%",
      type: "PERCENTAGE",
      value: 50,
      planTarget: "ALL",
      usageCount: 3,
      usageLimit: 10,
      isActive: true,
    },
    {
      id: "2",
      code: "PRO3MONTHS",
      description: "3 μήνες Pro δωρεάν",
      type: "FIXED_AMOUNT",
      value: 387,
      planTarget: "PRO",
      usageCount: 1,
      usageLimit: null,
      isActive: true,
    },
  ];

  return (
    <div className="sa-table-wrap">
      <table className="sa-table">
        <thead>
          <tr>
            <th>Κωδικός</th>
            <th>Περιγραφή</th>
            <th>Τύπος</th>
            <th>Αξία</th>
            <th>Πλάνο</th>
            <th>Χρήσεις</th>
            <th>Κατάσταση</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {mockCoupons.map((c) => (
            <tr key={c.id} className="sa-table-row">
              <td>
                <code className="sa-code">{c.code}</code>
              </td>
              <td>{c.description}</td>
              <td>{c.type === "PERCENTAGE" ? "Ποσοστό" : "Σταθερό"}</td>
              <td>
                {c.value}
                {c.type === "PERCENTAGE" ? "%" : "€"}
              </td>
              <td>{c.planTarget}</td>
              <td>
                {c.usageCount}/{c.usageLimit ?? "∞"}
              </td>
              <td>
                <span
                  className={`sa-status ${
                    c.isActive
                      ? "text-emerald-400 bg-emerald-400/10"
                      : "text-slate-400 bg-slate-400/10"
                  }`}
                >
                  {c.isActive ? <CheckCircle size={12} /> : <XCircle size={12} />}
                  {c.isActive ? "Ενεργός" : "Ανενεργός"}
                </span>
              </td>
              <td>
                <button className="sa-icon-btn">
                  <Edit size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
                placeholder="π.χ. P Rentals Χανιά"
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

// ─── Edit Tenant Modal ────────────────────

function EditTenantModal({
  tenant,
  onClose,
  onSuccess,
}: {
  tenant: Tenant;
  onClose: () => void;
  onSuccess: (t: Tenant) => void;
}) {
  const [form, setForm] = useState({
    name: tenant.name,
    email: tenant.email,
    phone: tenant.phone || "",
    plan: tenant.plan,
    status: tenant.status,
    brandColor: tenant.brandColor,
    website: "",
    customDomain: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
                <option value="ENTERPRISE">Enterprise</option>
              </select>
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
            <label>Custom Domain<input value={form.customDomain} onChange={e => setForm(f => ({...f, customDomain: e.target.value}))} placeholder="mycompany.gr" /></label>
            <label>Website (embed)<input value={form.website} onChange={e => setForm(f => ({...f, website: e.target.value}))} placeholder="https://mycompany.gr" /></label>
          </div>
        </div>
        <div className="sa-modal-footer">
          <button className="sa-btn-ghost" onClick={onClose}>Ακύρωση</button>
          <button className="sa-btn-primary" onClick={handleSubmit} disabled={loading}>
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

  .sa-sidebar-footer {
    padding: 12px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sa-user-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
  .sa-user-avatar {
    width: 30px; height: 30px;
    background: var(--primary);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; color: #fff;
    flex-shrink: 0;
  }
  .sa-user-name { font-size: 12px; font-weight: 600; color: var(--text); }
  .sa-user-email { font-size: 10px; color: var(--text-4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .sa-logout {
    background: none; border: none; color: var(--text-4); cursor: pointer;
    padding: 6px; border-radius: 6px;
    transition: all 0.15s;
  }
  .sa-logout:hover { background: var(--border); color: var(--text); }

  /* ── Main ── */
  .sa-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
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
  @media (max-width: 600px) {
    .sa-sidebar { display: none; }
    .sa-stats-bar { grid-template-columns: repeat(2, 1fr); }
  }
`;
