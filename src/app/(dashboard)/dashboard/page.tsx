import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
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

const eur = (n: number) =>
  new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const shortDate = (d: Date) =>
  new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "short" }).format(d);

const BOOKING_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Εκκρεμεί", cls: "warn" },
  CONFIRMED: { label: "Επιβεβαιωμένη", cls: "info" },
  ACTIVE: { label: "Ενεργή", cls: "ok" },
  COMPLETED: { label: "Ολοκληρώθηκε", cls: "muted" },
  CANCELLED: { label: "Ακυρώθηκε", cls: "bad" },
};

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  const tenantId = session.tenantId;

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
        <h1 className="dash-page-title">Καλημέρα, {session.name.split(" ")[0]} 👋</h1>
        <p className="dash-page-sub">
          Ορίστε μια γρήγορη εικόνα της επιχείρησής σου σήμερα.
        </p>
      </div>

      {/* KPIs */}
      <div className="dash-kpis">
        <div className="dash-card dash-card--green">
          <div className="dash-card-icon"><Car size={22} /></div>
          <div>
            <span className="dash-card-value">{available}</span>
            <span className="dash-card-label">Διαθέσιμα οχήματα</span>
          </div>
        </div>
        <div className="dash-card dash-card--indigo">
          <div className="dash-card-icon"><KeyRound size={22} /></div>
          <div>
            <span className="dash-card-value">{rented}</span>
            <span className="dash-card-label">Ενοικιασμένα</span>
          </div>
        </div>
        <div className="dash-card dash-card--amber">
          <div className="dash-card-icon"><Wrench size={22} /></div>
          <div>
            <span className="dash-card-value">{maintenance}</span>
            <span className="dash-card-label">Σε συντήρηση</span>
          </div>
        </div>
        <div className="dash-card dash-card--emerald">
          <div className="dash-card-icon"><Euro size={22} /></div>
          <div>
            <span className="dash-card-value">{eur(monthRevenue)}</span>
            <span className="dash-card-label">Έσοδα μήνα</span>
          </div>
        </div>
        <div className="dash-card dash-card--violet">
          <div className="dash-card-icon"><Gauge size={22} /></div>
          <div>
            <span className="dash-card-value">{occupancy}%</span>
            <span className="dash-card-label">Πληρότητα στόλου</span>
          </div>
        </div>
        <div className="dash-card dash-card--indigo">
          <div className="dash-card-icon"><CalendarDays size={22} /></div>
          <div>
            <span className="dash-card-value">{activeBookings}</span>
            <span className="dash-card-label">Ενεργές κρατήσεις</span>
          </div>
        </div>
      </div>

      {/* Alerts */}
      <h2 className="dash-section-title">
        <AlertTriangle size={17} /> Ειδοποιήσεις
      </h2>
      <div className="dash-alerts">
        {serviceSoon > 0 && (
          <div className="dash-alert dash-alert--warn">
            <Wrench size={20} />
            <span className="dash-alert-text">
              <strong>{serviceSoon}</strong> {serviceSoon === 1 ? "όχημα χρειάζεται" : "οχήματα χρειάζονται"} service (≤30 ημέρες)
            </span>
          </div>
        )}
        {insuranceSoon > 0 && (
          <div className="dash-alert dash-alert--danger">
            <ShieldAlert size={20} />
            <span className="dash-alert-text">
              <strong>{insuranceSoon}</strong> ασφάλ. λήγει σύντομα (≤60 ημέρες)
            </span>
          </div>
        )}
        {kteoSoon > 0 && (
          <div className="dash-alert dash-alert--danger">
            <ShieldAlert size={20} />
            <span className="dash-alert-text">
              <strong>{kteoSoon}</strong> ΚΤΕΟ λήγει σύντομα (≤60 ημέρες)
            </span>
          </div>
        )}
        {unsignedContracts > 0 && (
          <div className="dash-alert dash-alert--info">
            <PenLine size={20} />
            <span className="dash-alert-text">
              <strong>{unsignedContracts}</strong> ανυπόγραφα συμβόλαια
            </span>
          </div>
        )}
        {!hasAlerts && (
          <div className="dash-alert-ok">
            <CheckCircle2 size={18} /> Όλα εντάξει — καμία εκκρεμότητα αυτή τη στιγμή.
          </div>
        )}
      </div>

      {/* Δύο στήλες: πρόσφατες κρατήσεις + quick stats */}
      <div className="dash-cols">
        <div className="dash-panel">
          <h2 className="dash-section-title">
            <CalendarDays size={17} /> Πρόσφατες κρατήσεις
          </h2>
          {recentBookings.length === 0 ? (
            <div className="dash-empty">Δεν υπάρχουν κρατήσεις ακόμα.</div>
          ) : (
            recentBookings.map((b) => {
              const st = BOOKING_STATUS[b.status] ?? {
                label: b.status,
                cls: "muted",
              };
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
                    <span style={{ color: "#64748b", fontSize: 12 }}>
                      {b.vehicle.plate}
                    </span>
                  </div>
                  <div className="dash-booking-dates">
                    {shortDate(b.pickupDate)} → {shortDate(b.returnDate)}
                  </div>
                  <div className="dash-booking-total">{eur(Number(b.total))}</div>
                  <span className={`dash-status dash-status--${st.cls}`}>
                    {st.label}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="dash-panel">
          <h2 className="dash-section-title">
            <Gauge size={17} /> Εκκρεμότητες
          </h2>
          <div className="dash-ministat">
            <span className="dash-ministat-label">
              <AlertTriangle size={17} color="#f59e0b" /> Ζημιές σε εκκρεμότητα
            </span>
            <span
              className="dash-ministat-value"
              style={{ color: pendingDamages > 0 ? "#fbbf24" : "#e2e8f0" }}
            >
              {pendingDamages}
            </span>
          </div>
          <div className="dash-ministat">
            <span className="dash-ministat-label">
              <Receipt size={17} color="#ef4444" /> Απλήρωτα τιμολόγια
            </span>
            <span
              className="dash-ministat-value"
              style={{ color: unpaidInvoices > 0 ? "#f87171" : "#e2e8f0" }}
            >
              {unpaidInvoices}
            </span>
          </div>
          <div className="dash-ministat">
            <span className="dash-ministat-label">
              <Car size={17} color="#818cf8" /> Σύνολο στόλου
            </span>
            <span className="dash-ministat-value">{totalVehicles}</span>
          </div>
        </div>
      </div>
    </>
  );
}
