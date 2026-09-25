import { getSession } from "@/lib/auth";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { translator } from "@/lib/i18n";
import {
  Car,
  KeyRound,
  Wrench,
  Euro,
  Gauge,
  CalendarDays,
  ShieldAlert,
  PenLine,
  AlertTriangle,
  Receipt,
  CheckCircle2,
} from "lucide-react";

export const dynamic = "force-dynamic";

/** Χρήστης χωρίς καμία ενότητα: δεν τον στέλνουμε σε βρόχο. */
async function NoAccess() {
  const session = await getSession();
  const tr = translator(session?.locale ?? "el");

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("common.appName")}</h1>
      </div>
      <div className="dash-panel dash-empty">{tr("users.noAccess")}</div>
    </>
  );
}

const INTL_LOCALE: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL_LOCALE[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const shortDate = (d: Date, locale: string) =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? "el-GR", {
    day: "2-digit",
    month: "short",
  }).format(d);

// Η ετικέτα έρχεται από το namespace "status"· εδώ μένει μόνο το χρώμα.
const STATUS_CLASS: Record<string, string> = {
  PENDING: "warn",
  CONFIRMED: "info",
  ACTIVE: "ok",
  COMPLETED: "muted",
  CANCELLED: "bad",
};

export default async function DashboardPage() {
  // Ο Πίνακας είναι ο προορισμός κάθε άλλης ανακατεύθυνσης, οπότε ΔΕΝ
  // ανακατευθύνει στον εαυτό του: χωρίς δικαίωμα προβολής δείχνει ένα
  // καθαρό μήνυμα αντί να κάνει τη σελίδα να γυρίζει ατέρμονα.
  const guard = await pageGuard("dashboard.view");
  if (!guard) return <NoAccess />;
  const { session } = guard;

  const tenantId = session.tenantId;
  const locale = session.locale;
  const tr = translator(locale);

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const in60 = new Date(now.getTime() + 60 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    vehicleGroups,
    revenueAgg,
    serviceSoon,
    insuranceSoon,
    kteoSoon,
    unsignedContracts,
    pendingDamages,
    unpaidInvoices,
    activeBookings,
    recentBookings,
  ] = await Promise.all([
    db.vehicle.groupBy({
      by: ["status"],
      where: { tenantId, isActive: true },
      _count: true,
    }),
    db.invoice.aggregate({
      where: { tenantId, status: "PAID", paidAt: { gte: monthStart } },
      _sum: { total: true },
    }),
    db.vehicle.count({
      where: { tenantId, isActive: true, nextServiceDate: { lte: in30 } },
    }),
    db.vehicle.count({
      where: { tenantId, isActive: true, insuranceExpiry: { lte: in60 } },
    }),
    db.vehicle.count({
      where: { tenantId, isActive: true, kteoExpiry: { lte: in60 } },
    }),
    db.booking.count({
      where: {
        tenantId,
        status: { in: ["CONFIRMED", "ACTIVE"] },
        contractSigned: false,
      },
    }),
    db.damage.count({ where: { tenantId, status: "PENDING" } }),
    db.invoice.count({
      where: { tenantId, status: { in: ["UNPAID", "OVERDUE"] } },
    }),
    db.booking.count({ where: { tenantId, status: "ACTIVE" } }),
    db.booking.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        vehicle: { select: { brand: true, model: true, plate: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const vc: Record<string, number> = {};
  for (const g of vehicleGroups) vc[g.status] = g._count as unknown as number;
  const available = vc["AVAILABLE"] ?? 0;
  const rented = vc["RENTED"] ?? 0;
  const maintenance = vc["MAINTENANCE"] ?? 0;
  const totalVehicles = available + rented + maintenance + (vc["INACTIVE"] ?? 0);

  const monthRevenue = Number(revenueAgg._sum.total ?? 0);
  const occupancy =
    totalVehicles > 0 ? Math.round((rented / totalVehicles) * 100) : 0;

  const hasAlerts =
    serviceSoon > 0 || insuranceSoon > 0 || kteoSoon > 0 || unsignedContracts > 0;

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">
          {tr("dashboard.greeting")}, {session.name.split(" ")[0]} 👋
        </h1>
        <p className="dash-page-sub">{tr("dashboard.subtitle")}</p>
      </div>

      {/* KPIs */}
      <div className="dash-kpis">
        <div className="dash-card dash-card--green">
          <div className="dash-card-icon"><Car size={22} /></div>
          <div>
            <span className="dash-card-value">{available}</span>
            <span className="dash-card-label">{tr("dashboard.availableVehicles")}</span>
          </div>
        </div>
        <div className="dash-card dash-card--indigo">
          <div className="dash-card-icon"><KeyRound size={22} /></div>
          <div>
            <span className="dash-card-value">{rented}</span>
            <span className="dash-card-label">{tr("dashboard.rentedVehicles")}</span>
          </div>
        </div>
        <div className="dash-card dash-card--amber">
          <div className="dash-card-icon"><Wrench size={22} /></div>
          <div>
            <span className="dash-card-value">{maintenance}</span>
            <span className="dash-card-label">{tr("dashboard.inMaintenance")}</span>
          </div>
        </div>
        <div className="dash-card dash-card--emerald">
          <div className="dash-card-icon"><Euro size={22} /></div>
          <div>
            <span className="dash-card-value">{eur(monthRevenue, locale)}</span>
            <span className="dash-card-label">{tr("dashboard.monthRevenue")}</span>
          </div>
        </div>
        <div className="dash-card dash-card--violet">
          <div className="dash-card-icon"><Gauge size={22} /></div>
          <div>
            <span className="dash-card-value">{occupancy}%</span>
            <span className="dash-card-label">{tr("dashboard.fleetOccupancy")}</span>
          </div>
        </div>
        <div className="dash-card dash-card--indigo">
          <div className="dash-card-icon"><CalendarDays size={22} /></div>
          <div>
            <span className="dash-card-value">{activeBookings}</span>
            <span className="dash-card-label">{tr("dashboard.activeBookings")}</span>
          </div>
        </div>
      </div>

      {/* Alerts */}
      <h2 className="dash-section-title">
        <AlertTriangle size={17} /> {tr("dashboard.alerts")}
      </h2>
      <div className="dash-alerts">
        {serviceSoon > 0 && (
          <div className="dash-alert dash-alert--warn">
            <Wrench size={20} />
            <span className="dash-alert-text">
              <strong>{serviceSoon}</strong>{" "}
              {serviceSoon === 1
                ? tr("dashboard.alertServiceOne")
                : tr("dashboard.alertServiceMany")}
            </span>
          </div>
        )}
        {insuranceSoon > 0 && (
          <div className="dash-alert dash-alert--danger">
            <ShieldAlert size={20} />
            <span className="dash-alert-text">
              <strong>{insuranceSoon}</strong> {tr("dashboard.alertInsurance")}
            </span>
          </div>
        )}
        {kteoSoon > 0 && (
          <div className="dash-alert dash-alert--danger">
            <ShieldAlert size={20} />
            <span className="dash-alert-text">
              <strong>{kteoSoon}</strong> {tr("dashboard.alertMot")}
            </span>
          </div>
        )}
        {unsignedContracts > 0 && (
          <div className="dash-alert dash-alert--info">
            <PenLine size={20} />
            <span className="dash-alert-text">
              <strong>{unsignedContracts}</strong> {tr("dashboard.alertUnsignedContracts")}
            </span>
          </div>
        )}
        {!hasAlerts && (
          <div className="dash-alert-ok">
            <CheckCircle2 size={18} /> {tr("dashboard.allClear")}
          </div>
        )}
      </div>

      {/* Δύο στήλες: πρόσφατες κρατήσεις + quick stats */}
      <div className="dash-cols">
        <div className="dash-panel">
          <h2 className="dash-section-title">
            <CalendarDays size={17} /> {tr("dashboard.recentBookings")}
          </h2>
          {recentBookings.length === 0 ? (
            <div className="dash-empty">{tr("dashboard.noBookings")}</div>
          ) : (
            recentBookings.map((b) => {
              const statusCls = STATUS_CLASS[b.status] ?? "muted";
              const statusLabel = tr(`status.${b.status}`);
              return (
                <div key={b.id} className="dash-booking">
                  <div className="dash-booking-main">
                    <span className="dash-booking-number">{b.bookingNumber}</span>
                    <span className="dash-booking-customer">
                      {b.customer.firstName} {b.customer.lastName}
                    </span>
                  </div>
                  <div className="dash-booking-vehicle">
                    {b.vehicle.brand} {b.vehicle.model}
                    <br />
                    <span style={{ color: "var(--text-4)", fontSize: 12 }}>
                      {b.vehicle.plate}
                    </span>
                  </div>
                  <div className="dash-booking-dates">
                    {shortDate(b.pickupDate, locale)} →{" "}
                    {shortDate(b.returnDate, locale)}
                  </div>
                  <div className="dash-booking-total">
                    {eur(Number(b.total), locale)}
                  </div>
                  <span className={`dash-status dash-status--${statusCls}`}>
                    {statusLabel}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="dash-panel">
          <h2 className="dash-section-title">
            <Gauge size={17} /> {tr("dashboard.pendingItems")}
          </h2>
          <div className="dash-ministat">
            <span className="dash-ministat-label">
              <AlertTriangle size={17} color="var(--warn-icon)" />{" "}
              {tr("dashboard.pendingDamages")}
            </span>
            <span
              className="dash-ministat-value"
              style={{ color: pendingDamages > 0 ? "var(--warn-fg)" : "var(--text-4)" }}
            >
              {pendingDamages}
            </span>
          </div>
          <div className="dash-ministat">
            <span className="dash-ministat-label">
              <Receipt size={17} color="var(--bad-icon)" /> {tr("dashboard.unpaidInvoices")}
            </span>
            <span
              className="dash-ministat-value"
              style={{ color: unpaidInvoices > 0 ? "var(--bad-fg)" : "var(--text-4)" }}
            >
              {unpaidInvoices}
            </span>
          </div>
          <div className="dash-ministat">
            <span className="dash-ministat-label">
              <Car size={17} color="var(--primary)" /> {tr("dashboard.totalFleet")}
            </span>
            <span className="dash-ministat-value">{totalVehicles}</span>
          </div>
        </div>
      </div>
    </>
  );
}
