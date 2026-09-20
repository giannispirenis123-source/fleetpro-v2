"use client";

import { useMemo, useState } from "react";
import {
  Car,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Fuel,
  Users,
  Gauge,
  Wrench,
  ShieldAlert,
  CircleAlert,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  FUEL_TYPES,
  VEHICLE_CATEGORIES,
  VEHICLE_STATUSES,
  VEHICLE_STATUS_CLASS,
  SERVICE_WARN_DAYS,
  EXPIRY_WARN_DAYS,
  daysUntil,
  type VehicleDTO,
} from "@/lib/vehicles";

const INTL_LOCALE: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL_LOCALE[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const num = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL_LOCALE[locale] ?? "el-GR").format(n);

type StatusFilter = "ALL" | (typeof VEHICLE_STATUSES)[number];

const FILTERS: StatusFilter[] = ["ALL", "AVAILABLE", "RENTED", "MAINTENANCE"];

/** Κενή φόρμα — ίδια σειρά πεδίων με τα modals. */
const emptyForm = () => ({
  brand: "",
  model: "",
  plate: "",
  year: String(new Date().getFullYear()),
  dailyRate: "",
  color: "",
  category: "B",
  status: "AVAILABLE",
  fuel: "PETROL",
  seats: "5",
  doors: "4",
  transmission: "Manual",
  ac: true,
  km: "0",
  nextServiceKm: "",
  nextServiceDate: "",
  insuranceExpiry: "",
  kteoExpiry: "",
  notes: "",
});

type FormState = ReturnType<typeof emptyForm>;

const formFromVehicle = (v: VehicleDTO): FormState => ({
  brand: v.brand,
  model: v.model,
  plate: v.plate,
  year: String(v.year),
  dailyRate: String(v.dailyRate),
  color: v.color ?? "",
  category: v.category,
  status: v.status,
  fuel: v.fuel,
  seats: String(v.seats),
  doors: String(v.doors),
  transmission: v.transmission,
  ac: v.ac,
  km: String(v.km),
  nextServiceKm: v.nextServiceKm === null ? "" : String(v.nextServiceKm),
  nextServiceDate: v.nextServiceDate ?? "",
  insuranceExpiry: v.insuranceExpiry ?? "",
  kteoExpiry: v.kteoExpiry ?? "",
  notes: v.notes ?? "",
});

/** Μετατρέπει τη φόρμα σε σώμα αιτήματος — αριθμοί ως αριθμοί, κενά ως null. */
const formToPayload = (f: FormState) => ({
  brand: f.brand.trim(),
  model: f.model.trim(),
  plate: f.plate.trim(),
  year: Number(f.year),
  dailyRate: Number(f.dailyRate),
  color: f.color.trim() || null,
  category: f.category,
  status: f.status,
  fuel: f.fuel,
  seats: Number(f.seats),
  doors: Number(f.doors),
  transmission: f.transmission.trim() || "Manual",
  ac: f.ac,
  km: Number(f.km || 0),
  nextServiceKm: f.nextServiceKm === "" ? null : Number(f.nextServiceKm),
  nextServiceDate: f.nextServiceDate || null,
  insuranceExpiry: f.insuranceExpiry || null,
  kteoExpiry: f.kteoExpiry || null,
  notes: f.notes.trim() || null,
});

export default function FleetClient({
  initialVehicles,
  role,
}: {
  initialVehicles: VehicleDTO[];
  role: string;
}) {
  const tr = useT();
  const locale = useLocale();

  const canManage = role === "COMPANY_ADMIN";

  const [vehicles, setVehicles] = useState<VehicleDTO[]>(initialVehicles);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<VehicleDTO | null>(null);
  const [deleting, setDeleting] = useState<VehicleDTO | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      const matchesStatus = filter === "ALL" || v.status === filter;
      const matchesSearch =
        !q ||
        v.brand.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        v.plate.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [vehicles, search, filter]);

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("fleet.title")}</h1>
          <p className="dash-page-sub">{tr("fleet.subtitle")}</p>
        </div>
        {canManage && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={17} /> {tr("fleet.addVehicle")}
          </button>
        )}
      </div>

      {/* Φίλτρα + αναζήτηση */}
      <div className="dash-toolbar">
        <div className="dash-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("fleet.searchPlaceholder")}
          />
        </div>
        <div className="dash-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`dash-filter ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {f === "ALL" ? tr("fleet.filterAll") : tr(`vehicleStatus.${f}`)}
            </button>
          ))}
        </div>
        <span className="dash-count">
          {visible.length}{" "}
          {visible.length === 1
            ? tr("fleet.vehicleCountOne")
            : tr("fleet.vehicleCount")}
        </span>
      </div>

      {/* Λίστα */}
      {visible.length === 0 ? (
        <div className="dash-panel dash-empty">
          {vehicles.length === 0 ? tr("fleet.empty") : tr("fleet.emptyFiltered")}
        </div>
      ) : (
        <div className="dash-vehicles">
          {visible.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              locale={locale}
              tr={tr}
              canManage={canManage}
              onEdit={() => setEditing(v)}
              onDelete={() => setDeleting(v)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <VehicleModal
          mode="create"
          tr={tr}
          onClose={() => setShowCreate(false)}
          onSaved={(vehicle) => {
            setVehicles((prev) =>
              [...prev, vehicle].sort(
                (a, b) =>
                  a.brand.localeCompare(b.brand) ||
                  a.model.localeCompare(b.model)
              )
            );
            setShowCreate(false);
          }}
        />
      )}

      {editing && (
        <VehicleModal
          mode="edit"
          vehicle={editing}
          tr={tr}
          onClose={() => setEditing(null)}
          onSaved={(vehicle) => {
            setVehicles((prev) =>
              prev.map((v) => (v.id === vehicle.id ? vehicle : v))
            );
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <DeleteVehicleModal
          vehicle={deleting}
          tr={tr}
          onClose={() => setDeleting(null)}
          onDeleted={(id) => {
            setVehicles((prev) => prev.filter((v) => v.id !== id));
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Κάρτα οχήματος
   ───────────────────────────────────────────── */

function VehicleCard({
  vehicle: v,
  locale,
  tr,
  canManage,
  onEdit,
  onDelete,
}: {
  vehicle: VehicleDTO;
  locale: string;
  tr: (key: string) => string;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const badges = [
    {
      key: "service",
      days: daysUntil(v.nextServiceDate),
      limit: SERVICE_WARN_DAYS,
      label: tr("fleet.serviceDue"),
      Icon: Wrench,
    },
    {
      key: "insurance",
      days: daysUntil(v.insuranceExpiry),
      limit: EXPIRY_WARN_DAYS,
      label: tr("fleet.insuranceDue"),
      Icon: ShieldAlert,
    },
    {
      key: "mot",
      days: daysUntil(v.kteoExpiry),
      limit: EXPIRY_WARN_DAYS,
      label: tr("fleet.motDue"),
      Icon: CircleAlert,
    },
  ].filter((b) => b.days !== null && b.days <= b.limit);

  return (
    <div className="dash-vehicle">
      <div className="dash-vehicle-top">
        <div className="dash-vehicle-icon">
          <Car size={20} />
        </div>
        <div className="dash-vehicle-id">
          <span className="dash-vehicle-name">
            {v.brand} {v.model}
          </span>
          <span className="dash-vehicle-plate">{v.plate}</span>
        </div>
        <span
          className={`dash-status dash-status--${
            VEHICLE_STATUS_CLASS[v.status] ?? "muted"
          }`}
        >
          {tr(`vehicleStatus.${v.status}`)}
        </span>
      </div>

      <div className="dash-vehicle-specs">
        <span>{v.year}</span>
        <span>{tr(`vehicleCategory.${v.category}`)}</span>
        <span>
          <Fuel size={13} /> {tr(`fuelType.${v.fuel}`)}
        </span>
        <span>
          <Users size={13} /> {v.seats} {tr("fleet.seats")}
        </span>
        <span>
          <Gauge size={13} /> {num(v.km, locale)} {tr("fleet.km")}
        </span>
      </div>

      {badges.length > 0 && (
        <div className="dash-vehicle-badges">
          {badges.map(({ key, days, label, Icon }) => (
            <span
              key={key}
              className={`dash-badge ${
                (days as number) < 0 ? "dash-badge--bad" : "dash-badge--warn"
              }`}
            >
              <Icon size={12} /> {label}{" "}
              {(days as number) < 0
                ? tr("fleet.expired")
                : tr("fleet.inDays").replace("{days}", String(days))}
            </span>
          ))}
        </div>
      )}

      <div className="dash-vehicle-foot">
        <span className="dash-vehicle-rate">
          {eur(v.dailyRate, locale)}
          <small>{tr("fleet.perDay")}</small>
        </span>
        {canManage && (
          <div className="dash-vehicle-actions">
            <button
              className="dash-icon-btn"
              onClick={onEdit}
              title={tr("fleet.edit")}
              aria-label={tr("fleet.edit")}
            >
              <Pencil size={16} />
            </button>
            <button
              className="dash-icon-btn dash-icon-btn--danger"
              onClick={onDelete}
              title={tr("fleet.delete")}
              aria-label={tr("fleet.delete")}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Modal δημιουργίας / επεξεργασίας
   ───────────────────────────────────────────── */

function VehicleModal({
  mode,
  vehicle,
  tr,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  vehicle?: VehicleDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onSaved: (vehicle: VehicleDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(
    vehicle ? formFromVehicle(vehicle) : emptyForm()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        mode === "create" ? "/api/vehicles" : `/api/vehicles/${vehicle!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(form)),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("fleet.errorSave"));
        return;
      }

      onSaved(data.data.vehicle);
    } catch {
      setError(tr("fleet.errorConnection"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>{mode === "create" ? tr("fleet.newVehicle") : tr("fleet.editVehicle")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <div className="dash-form-grid">
            <label className="dash-field">
              {tr("fleet.brand")} *
              <input
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
                autoFocus
              />
            </label>
            <label className="dash-field">
              {tr("fleet.model")} *
              <input
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("fleet.plate")} *
              <input
                value={form.plate}
                onChange={(e) => set("plate", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("fleet.year")} *
              <input
                type="number"
                value={form.year}
                onChange={(e) => set("year", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("fleet.dailyRate")} *
              <input
                type="number"
                step="0.01"
                value={form.dailyRate}
                onChange={(e) => set("dailyRate", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("fleet.color")}
              <input
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
              />
            </label>

            <label className="dash-field">
              {tr("fleet.category")}
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
              >
                {VEHICLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {tr(`vehicleCategory.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="dash-field">
              {tr("fleet.status")}
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {VEHICLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tr(`vehicleStatus.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="dash-field">
              {tr("fleet.fuel")}
              <select
                value={form.fuel}
                onChange={(e) => set("fuel", e.target.value)}
              >
                {FUEL_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {tr(`fuelType.${f}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field">
              {tr("fleet.seatsField")}
              <input
                type="number"
                value={form.seats}
                onChange={(e) => set("seats", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("fleet.doorsField")}
              <input
                type="number"
                value={form.doors}
                onChange={(e) => set("doors", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("fleet.transmission")}
              <input
                value={form.transmission}
                onChange={(e) => set("transmission", e.target.value)}
              />
            </label>

            <label className="dash-field">
              {tr("fleet.kmField")}
              <input
                type="number"
                value={form.km}
                onChange={(e) => set("km", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("fleet.nextServiceKm")}
              <input
                type="number"
                value={form.nextServiceKm}
                onChange={(e) => set("nextServiceKm", e.target.value)}
              />
            </label>
            <label className="dash-field dash-field--check">
              <input
                type="checkbox"
                checked={form.ac}
                onChange={(e) => set("ac", e.target.checked)}
              />
              {tr("fleet.ac")}
            </label>

            <label className="dash-field">
              {tr("fleet.nextServiceDate")}
              <input
                type="date"
                value={form.nextServiceDate}
                onChange={(e) => set("nextServiceDate", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("fleet.insuranceExpiry")}
              <input
                type="date"
                value={form.insuranceExpiry}
                onChange={(e) => set("insuranceExpiry", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("fleet.kteoExpiry")}
              <input
                type="date"
                value={form.kteoExpiry}
                onChange={(e) => set("kteoExpiry", e.target.value)}
              />
            </label>

            <label className="dash-field dash-field--wide">
              {tr("fleet.notes")}
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
          </div>

          {error && <div className="dash-form-error">{error}</div>}
          <p className="dash-form-note">{tr("fleet.requiredNote")}</p>
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("fleet.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? tr("fleet.saving") : tr("fleet.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Επιβεβαίωση διαγραφής
   ───────────────────────────────────────────── */

function DeleteVehicleModal({
  vehicle,
  tr,
  onClose,
  onDeleted,
}: {
  vehicle: VehicleDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/vehicles/${vehicle.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || tr("fleet.errorSave"));
        return;
      }

      onDeleted(vehicle.id);
    } catch {
      setError(tr("fleet.errorConnection"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div
        className="dash-modal dash-modal--sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dash-modal-header">
          <h2>{tr("fleet.confirmDeleteTitle")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <p className="dash-confirm-vehicle">
            {vehicle.brand} {vehicle.model} · {vehicle.plate}
          </p>
          <p className="dash-form-note">{tr("fleet.confirmDeleteBody")}</p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("fleet.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--danger"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading ? tr("fleet.deleting") : tr("fleet.confirmDelete")}
          </button>
        </div>
      </div>
    </div>
  );
}
