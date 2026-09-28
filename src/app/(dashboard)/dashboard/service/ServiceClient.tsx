"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Wrench,
  AlertTriangle,
  Pencil,
  Trash2,
  X,
  Check,
  Car,
  CalendarDays,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  SERVICE_TYPES,
  DAMAGE_STATUS_CLASS,
  dueState,
  type ServiceRecordDTO,
  type DamageDTO,
} from "@/lib/service";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);

const shortDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL[locale] ?? "el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));

const today = () => new Date().toISOString().slice(0, 10);

export interface Option {
  id: string;
  label: string;
}
export interface BookingOption extends Option {
  vehicleId: string;
}

export interface Can {
  serviceView: boolean;
  serviceCreate: boolean;
  serviceEdit: boolean;
  serviceDelete: boolean;
  damagesView: boolean;
  damagesCreate: boolean;
  damagesEdit: boolean;
  damagesDelete: boolean;
}

type Tab = "SERVICE" | "DAMAGES";

/* ─────────────────────────────────────────────
   Σελίδα
   ───────────────────────────────────────────── */

export default function ServiceClient({
  initialRecords,
  initialDamages,
  vehicles,
  bookings,
  can,
}: {
  initialRecords: ServiceRecordDTO[];
  initialDamages: DamageDTO[];
  vehicles: Option[];
  bookings: BookingOption[];
  can: Can;
}) {
  const tr = useT();
  const locale = useLocale();

  const [tab, setTab] = useState<Tab>(
    can.serviceView ? "SERVICE" : "DAMAGES"
  );
  const [records, setRecords] = useState(initialRecords);
  const [damages, setDamages] = useState(initialDamages);

  const [vehicleFilter, setVehicleFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [error, setError] = useState("");

  const [editRecord, setEditRecord] = useState<ServiceRecordDTO | null>(null);
  const [newRecord, setNewRecord] = useState(false);
  const [editDamage, setEditDamage] = useState<DamageDTO | null>(null);
  const [newDamage, setNewDamage] = useState(false);
  const [removing, setRemoving] = useState<
    { kind: Tab; id: string; label: string } | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visibleRecords = useMemo(
    () =>
      records.filter(
        (r) =>
          (!vehicleFilter || r.vehicleId === vehicleFilter) &&
          (typeFilter === "ALL" || r.type === typeFilter)
      ),
    [records, vehicleFilter, typeFilter]
  );

  const visibleDamages = useMemo(
    () =>
      damages.filter(
        (d) =>
          (!vehicleFilter || d.vehicleId === vehicleFilter) &&
          (statusFilter === "ALL" || d.status === statusFilter)
      ),
    [damages, vehicleFilter, statusFilter]
  );

  const upsertRecord = (r: ServiceRecordDTO) =>
    setRecords((prev) =>
      prev.some((x) => x.id === r.id)
        ? prev.map((x) => (x.id === r.id ? r : x))
        : [r, ...prev]
    );

  const upsertDamage = (d: DamageDTO) =>
    setDamages((prev) =>
      prev.some((x) => x.id === d.id)
        ? prev.map((x) => (x.id === d.id ? d : x))
        : [d, ...prev]
    );

  const resolve = async (d: DamageDTO) => {
    if (busyId) return;
    setBusyId(d.id);
    setError("");

    try {
      const res = await fetch(`/api/damages/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RESOLVED" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || tr("service.errorSave"));
        return;
      }
      upsertDamage(data.data.damage);
    } catch {
      setError(tr("service.errorConnection"));
    } finally {
      setBusyId(null);
    }
  };

  const doRemove = async () => {
    if (!removing || busyId) return;
    setBusyId(removing.id);
    setError("");

    const url =
      removing.kind === "SERVICE"
        ? `/api/service/${removing.id}`
        : `/api/damages/${removing.id}`;

    try {
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || tr("service.errorSave"));
        return;
      }
      if (removing.kind === "SERVICE") {
        setRecords((prev) => prev.filter((x) => x.id !== removing.id));
      } else {
        setDamages((prev) => prev.filter((x) => x.id !== removing.id));
      }
      setRemoving(null);
    } catch {
      setError(tr("service.errorConnection"));
    } finally {
      setBusyId(null);
    }
  };

  const showing = tab === "SERVICE" ? visibleRecords.length : visibleDamages.length;

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("service.title")}</h1>
          <p className="dash-page-sub">{tr("service.subtitle")}</p>
        </div>
        {tab === "SERVICE" && can.serviceCreate && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={() => setNewRecord(true)}
          >
            <Plus size={17} /> {tr("service.addRecord")}
          </button>
        )}
        {tab === "DAMAGES" && can.damagesCreate && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={() => setNewDamage(true)}
          >
            <Plus size={17} /> {tr("service.addDamage")}
          </button>
        )}
      </div>

      <div className="dash-filters dash-service-tabs">
        {can.serviceView && (
          <button
            className={`dash-filter ${tab === "SERVICE" ? "active" : ""}`}
            onClick={() => setTab("SERVICE")}
            aria-pressed={tab === "SERVICE"}
          >
            <Wrench size={15} /> {tr("service.tabService")} ({records.length})
          </button>
        )}
        {can.damagesView && (
          <button
            className={`dash-filter ${tab === "DAMAGES" ? "active" : ""}`}
            onClick={() => setTab("DAMAGES")}
            aria-pressed={tab === "DAMAGES"}
          >
            <AlertTriangle size={15} /> {tr("service.tabDamages")} (
            {damages.length})
          </button>
        )}
      </div>

      <div className="dash-toolbar">
        <label className="dash-field dash-field--inline">
          {tr("service.vehicle")}
          <select
            value={vehicleFilter}
            onChange={(e) => setVehicleFilter(e.target.value)}
          >
            <option value="">{tr("service.allVehicles")}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        {tab === "SERVICE" ? (
          <label className="dash-field dash-field--inline">
            {tr("service.type")}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="ALL">{tr("service.allTypes")}</option>
              {SERVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {tr(`serviceType.${t}`)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="dash-filters">
            {["ALL", "PENDING", "RESOLVED"].map((f) => (
              <button
                key={f}
                className={`dash-filter ${statusFilter === f ? "active" : ""}`}
                onClick={() => setStatusFilter(f)}
                aria-pressed={statusFilter === f}
              >
                {f === "ALL"
                  ? tr("service.allStatuses")
                  : tr(`damageStatus.${f}`)}
              </button>
            ))}
          </div>
        )}

        <span className="dash-count">
          {showing} {tr("service.records")}
        </span>
      </div>

      {error && <div className="dash-form-error">{error}</div>}

      {tab === "SERVICE" ? (
        visibleRecords.length === 0 ? (
          <div className="dash-panel dash-empty">{tr("service.emptyService")}</div>
        ) : (
          <div className="dash-invoices">
            {visibleRecords.map((r) => (
              <ServiceRow
                key={r.id}
                record={r}
                tr={tr}
                locale={locale}
                can={can}
                onEdit={() => setEditRecord(r)}
                onDelete={() =>
                  setRemoving({
                    kind: "SERVICE",
                    id: r.id,
                    label: `${tr(`serviceType.${r.type}`)} · ${r.vehiclePlate}`,
                  })
                }
              />
            ))}
          </div>
        )
      ) : visibleDamages.length === 0 ? (
        <div className="dash-panel dash-empty">{tr("service.emptyDamages")}</div>
      ) : (
        <div className="dash-invoices">
          {visibleDamages.map((d) => (
            <DamageRow
              key={d.id}
              damage={d}
              tr={tr}
              locale={locale}
              can={can}
              busy={busyId === d.id}
              onResolve={() => resolve(d)}
              onEdit={() => setEditDamage(d)}
              onDelete={() =>
                setRemoving({
                  kind: "DAMAGES",
                  id: d.id,
                  label: d.description,
                })
              }
            />
          ))}
        </div>
      )}

      {(newRecord || editRecord) && (
        <ServiceModal
          record={editRecord}
          vehicles={vehicles}
          tr={tr}
          onClose={() => {
            setNewRecord(false);
            setEditRecord(null);
          }}
          onSaved={(r) => {
            upsertRecord(r);
            setNewRecord(false);
            setEditRecord(null);
          }}
        />
      )}

      {(newDamage || editDamage) && (
        <DamageModal
          damage={editDamage}
          vehicles={vehicles}
          bookings={bookings}
          tr={tr}
          onClose={() => {
            setNewDamage(false);
            setEditDamage(null);
          }}
          onSaved={(d) => {
            upsertDamage(d);
            setNewDamage(false);
            setEditDamage(null);
          }}
        />
      )}

      {removing && (
        <div className="dash-modal-overlay" onClick={() => setRemoving(null)}>
          <div
            className="dash-modal dash-modal--sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dash-modal-header">
              <h2>{tr("service.confirmDeleteTitle")}</h2>
              <button
                className="dash-modal-close"
                onClick={() => setRemoving(null)}
                aria-label={tr("service.cancel")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dash-modal-body">
              <p className="dash-confirm-vehicle">{removing.label}</p>
              <p className="dash-form-note">{tr("service.confirmDeleteBody")}</p>
            </div>
            <div className="dash-modal-footer">
              <button className="dash-btn" onClick={() => setRemoving(null)}>
                {tr("service.cancel")}
              </button>
              <button
                className="dash-btn dash-btn--danger"
                onClick={doRemove}
                disabled={Boolean(busyId)}
              >
                {tr("service.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Γραμμή service
   ───────────────────────────────────────────── */

function ServiceRow({
  record: r,
  tr,
  locale,
  can,
  onEdit,
  onDelete,
}: {
  record: ServiceRecordDTO;
  tr: (key: string) => string;
  locale: string;
  can: Can;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const due = dueState(r.nextServiceDate, today());

  return (
    <div className="dash-invoice">
      <div className="dash-invoice-id">
        <span className="dash-invoice-number">
          <Wrench size={15} /> {tr(`serviceType.${r.type}`)}
        </span>
        {due && (
          <span
            className={`dash-status dash-status--${due === "overdue" ? "bad" : "warn"}`}
          >
            {tr(due === "overdue" ? "service.overdue" : "service.dueSoon")}
          </span>
        )}
      </div>

      <div className="dash-invoice-who">
        <span className="dash-invoice-customer">
          {r.vehicleName} · {r.vehiclePlate}
        </span>
        <span className="dash-invoice-booking">
          {shortDate(r.date, locale)}
          {r.shop && ` · ${r.shop}`}
          {r.km !== null && ` · ${r.km.toLocaleString(INTL[locale] ?? "el-GR")} km`}
        </span>
        {r.nextServiceDate && (
          <span className="dash-invoice-booking">
            {tr("service.next")}: {shortDate(r.nextServiceDate, locale)}
            {r.nextServiceKm !== null &&
              ` · ${r.nextServiceKm.toLocaleString(INTL[locale] ?? "el-GR")} km`}
          </span>
        )}
        {r.notes && <span className="dash-invoice-booking">{r.notes}</span>}
      </div>

      <div className="dash-invoice-money">
        <span className="dash-invoice-total">
          {r.cost === null ? "—" : eur(r.cost, locale)}
        </span>
      </div>

      <div className="dash-invoice-actions">
        {can.serviceEdit && (
          <button
            className="dash-icon-btn"
            onClick={onEdit}
            title={tr("service.edit")}
            aria-label={tr("service.edit")}
          >
            <Pencil size={16} />
          </button>
        )}
        {can.serviceDelete && (
          <button
            className="dash-icon-btn dash-icon-btn--danger"
            onClick={onDelete}
            title={tr("service.delete")}
            aria-label={tr("service.delete")}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Γραμμή ζημιάς
   ───────────────────────────────────────────── */

function DamageRow({
  damage: d,
  tr,
  locale,
  can,
  busy,
  onResolve,
  onEdit,
  onDelete,
}: {
  damage: DamageDTO;
  tr: (key: string) => string;
  locale: string;
  can: Can;
  busy: boolean;
  onResolve: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="dash-invoice">
      <div className="dash-invoice-id">
        <span className="dash-invoice-number">
          <AlertTriangle size={15} /> {shortDate(d.date, locale)}
        </span>
        <span
          className={`dash-status dash-status--${DAMAGE_STATUS_CLASS[d.status] ?? "muted"}`}
        >
          {tr(`damageStatus.${d.status}`)}
        </span>
      </div>

      <div className="dash-invoice-who">
        <span className="dash-invoice-customer">{d.description}</span>
        <span className="dash-invoice-booking">
          {d.vehicleName} · {d.vehiclePlate}
          {d.bookingNumber
            ? ` · ${tr("service.fromBooking")} ${d.bookingNumber}`
            : ` · ${tr("service.noBooking")}`}
        </span>
        {d.notes && <span className="dash-invoice-booking">{d.notes}</span>}
      </div>

      <div className="dash-invoice-money">
        <span className="dash-invoice-total">
          {d.repairCost === null ? "—" : eur(d.repairCost, locale)}
        </span>
        {d.resolvedAt && (
          <span className="dash-invoice-line">
            {tr("service.resolvedOn")} {shortDate(d.resolvedAt, locale)}
          </span>
        )}
      </div>

      <div className="dash-invoice-actions">
        {d.status === "PENDING" && can.damagesEdit && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={onResolve}
            disabled={busy}
          >
            <Check size={16} /> {tr("service.markResolved")}
          </button>
        )}
        {can.damagesEdit && (
          <button
            className="dash-icon-btn"
            onClick={onEdit}
            title={tr("service.edit")}
            aria-label={tr("service.edit")}
          >
            <Pencil size={16} />
          </button>
        )}
        {can.damagesDelete && (
          <button
            className="dash-icon-btn dash-icon-btn--danger"
            onClick={onDelete}
            title={tr("service.delete")}
            aria-label={tr("service.delete")}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Φόρμα service
   ───────────────────────────────────────────── */

function ServiceModal({
  record,
  vehicles,
  tr,
  onClose,
  onSaved,
}: {
  record: ServiceRecordDTO | null;
  vehicles: Option[];
  tr: (key: string) => string;
  onClose: () => void;
  onSaved: (r: ServiceRecordDTO) => void;
}) {
  const [form, setForm] = useState({
    vehicleId: record?.vehicleId ?? vehicles[0]?.id ?? "",
    type: record?.type ?? "REGULAR",
    date: record?.date ?? today(),
    cost: record?.cost === null || record === null ? "" : String(record.cost),
    shop: record?.shop ?? "",
    km: record?.km === null || record === null ? "" : String(record.km),
    notes: record?.notes ?? "",
    nextServiceDate: record?.nextServiceDate ?? "",
    nextServiceKm:
      record?.nextServiceKm === null || record === null
        ? ""
        : String(record.nextServiceKm),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<typeof form>) =>
    setForm((f) => ({ ...f, ...patch }));

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const save = async () => {
    if (saving) return;
    if (!form.vehicleId) {
      setError(tr("service.errorVehicle"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch(
        record ? `/api/service/${record.id}` : "/api/service",
        {
          method: record ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId: form.vehicleId,
            type: form.type,
            date: form.date,
            cost: num(form.cost),
            shop: form.shop.trim() || null,
            km: num(form.km),
            notes: form.notes.trim() || null,
            nextServiceDate: form.nextServiceDate || null,
            nextServiceKm: num(form.nextServiceKm),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || tr("service.errorSave"));
        return;
      }
      onSaved(data.data.record);
    } catch {
      setError(tr("service.errorConnection"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>{tr(record ? "service.editRecord" : "service.newRecord")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("service.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <div className="dash-form-grid">
            <label className="dash-field dash-field--wide">
              <span>
                <Car size={13} /> {tr("service.vehicle")}
              </span>
              <select
                value={form.vehicleId}
                onChange={(e) => set({ vehicleId: e.target.value })}
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field">
              {tr("service.type")}
              <select
                value={form.type}
                onChange={(e) => set({ type: e.target.value })}
              >
                {SERVICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {tr(`serviceType.${t}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field">
              {tr("service.date")}
              <input
                type="date"
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </label>

            <label className="dash-field">
              {tr("service.cost")}
              <input
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={form.cost}
                onChange={(e) => set({ cost: e.target.value })}
              />
            </label>

            <label className="dash-field">
              {tr("service.km")}
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={form.km}
                onChange={(e) => set({ km: e.target.value })}
              />
            </label>

            <label className="dash-field dash-field--wide">
              {tr("service.shop")}
              <input
                value={form.shop}
                onChange={(e) => set({ shop: e.target.value })}
              />
            </label>

            <label className="dash-field">
              {tr("service.nextDate")}
              <input
                type="date"
                value={form.nextServiceDate}
                onChange={(e) => set({ nextServiceDate: e.target.value })}
              />
            </label>

            <label className="dash-field">
              {tr("service.nextKm")}
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={form.nextServiceKm}
                onChange={(e) => set({ nextServiceKm: e.target.value })}
              />
            </label>

            <label className="dash-field dash-field--wide">
              {tr("service.notes")}
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </label>
          </div>

          <p className="dash-form-note">{tr("service.nextNote")}</p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose}>
            {tr("service.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? tr("service.saving") : tr("service.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Φόρμα ζημιάς
   ───────────────────────────────────────────── */

function DamageModal({
  damage,
  vehicles,
  bookings,
  tr,
  onClose,
  onSaved,
}: {
  damage: DamageDTO | null;
  vehicles: Option[];
  bookings: BookingOption[];
  tr: (key: string) => string;
  onClose: () => void;
  onSaved: (d: DamageDTO) => void;
}) {
  const [form, setForm] = useState({
    vehicleId: damage?.vehicleId ?? vehicles[0]?.id ?? "",
    bookingId: damage?.bookingId ?? "",
    description: damage?.description ?? "",
    date: damage?.date ?? today(),
    repairCost:
      damage?.repairCost === null || damage === null
        ? ""
        : String(damage.repairCost),
    status: damage?.status ?? "PENDING",
    notes: damage?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<typeof form>) =>
    setForm((f) => ({ ...f, ...patch }));

  // Μόνο κρατήσεις ΑΥΤΟΥ του οχήματος: ο server το επιβάλλει ούτως ή
  // άλλως, αλλά η φόρμα δεν πρέπει καν να προσφέρει λάθος επιλογή.
  const ownBookings = bookings.filter((b) => b.vehicleId === form.vehicleId);

  const save = async () => {
    if (saving) return;
    if (!form.vehicleId) {
      setError(tr("service.errorVehicle"));
      return;
    }
    if (form.description.trim().length < 3) {
      setError(tr("service.errorDescription"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch(
        damage ? `/api/damages/${damage.id}` : "/api/damages",
        {
          method: damage ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId: form.vehicleId,
            bookingId: form.bookingId || null,
            description: form.description.trim(),
            date: form.date,
            repairCost:
              form.repairCost.trim() === "" ? null : Number(form.repairCost),
            status: form.status,
            notes: form.notes.trim() || null,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || tr("service.errorSave"));
        return;
      }
      onSaved(data.data.damage);
    } catch {
      setError(tr("service.errorConnection"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>{tr(damage ? "service.editDamage" : "service.newDamage")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("service.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <div className="dash-form-grid">
            <label className="dash-field dash-field--wide">
              <span>
                <Car size={13} /> {tr("service.vehicle")}
              </span>
              <select
                value={form.vehicleId}
                onChange={(e) =>
                  // Αλλαγή οχήματος ακυρώνει την επιλεγμένη κράτηση: δεν
                  // μπορεί να ανήκει και στα δύο.
                  set({ vehicleId: e.target.value, bookingId: "" })
                }
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field dash-field--wide">
              <span>
                <CalendarDays size={13} /> {tr("service.booking")}
              </span>
              <select
                value={form.bookingId}
                onChange={(e) => set({ bookingId: e.target.value })}
              >
                <option value="">{tr("service.noBookingOption")}</option>
                {ownBookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field dash-field--wide">
              {tr("service.description")}
              <input
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </label>

            <label className="dash-field">
              {tr("service.date")}
              <input
                type="date"
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </label>

            <label className="dash-field">
              {tr("service.repairCost")}
              <input
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={form.repairCost}
                onChange={(e) => set({ repairCost: e.target.value })}
              />
            </label>

            <label className="dash-field dash-field--wide">
              {tr("service.status")}
              <select
                value={form.status}
                onChange={(e) => set({ status: e.target.value })}
              >
                {["PENDING", "RESOLVED"].map((s) => (
                  <option key={s} value={s}>
                    {tr(`damageStatus.${s}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field dash-field--wide">
              {tr("service.notes")}
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </label>
          </div>

          <p className="dash-form-note">{tr("service.damageNote")}</p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose}>
            {tr("service.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? tr("service.saving") : tr("service.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
