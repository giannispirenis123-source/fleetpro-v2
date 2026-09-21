"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  PackagePlus,
  ShieldCheck,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  CHARGE_TYPES,
  EXTRA_TYPES,
  EXTRA_TYPE_CLASS,
  type ExtraDTO,
} from "@/lib/extras";

const INTL_LOCALE: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL_LOCALE[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(n);

type TypeFilter = "ALL" | (typeof EXTRA_TYPES)[number];

const FILTERS: TypeFilter[] = ["ALL", "EXTRA", "INSURANCE"];

const emptyForm = () => ({
  name: "",
  price: "",
  chargeType: "PER_DAY",
  type: "EXTRA",
  isActive: true,
});

type FormState = ReturnType<typeof emptyForm>;

const formFromExtra = (e: ExtraDTO): FormState => ({
  name: e.name,
  price: String(e.price),
  chargeType: e.chargeType,
  type: e.type,
  isActive: e.isActive,
});

const formToPayload = (f: FormState) => ({
  name: f.name.trim(),
  price: Number(f.price),
  chargeType: f.chargeType,
  type: f.type,
  isActive: f.isActive,
});

export default function ExtrasClient({
  initialExtras,
  role,
}: {
  initialExtras: ExtraDTO[];
  role: string;
}) {
  const tr = useT();
  const locale = useLocale();

  const canManage = role === "COMPANY_ADMIN";

  const [extras, setExtras] = useState<ExtraDTO[]>(initialExtras);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TypeFilter>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ExtraDTO | null>(null);
  const [deleting, setDeleting] = useState<ExtraDTO | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return extras.filter((e) => {
      const matchesType = filter === "ALL" || e.type === filter;
      const matchesSearch = !q || e.name.toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [extras, search, filter]);

  const sortExtras = (list: ExtraDTO[]) =>
    [...list].sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
    );

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("extras.title")}</h1>
          <p className="dash-page-sub">{tr("extras.subtitle")}</p>
        </div>
        {canManage && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={17} /> {tr("extras.addExtra")}
          </button>
        )}
      </div>

      <div className="dash-toolbar">
        <div className="dash-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("extras.searchPlaceholder")}
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
              {f === "ALL" ? tr("extras.filterAll") : tr(`extraType.${f}`)}
            </button>
          ))}
        </div>
        <span className="dash-count">
          {visible.length}{" "}
          {visible.length === 1
            ? tr("extras.extraCountOne")
            : tr("extras.extraCount")}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="dash-panel dash-empty">
          {extras.length === 0 ? tr("extras.empty") : tr("extras.emptyFiltered")}
        </div>
      ) : (
        <div className="dash-vehicles">
          {visible.map((e) => (
            <ExtraCard
              key={e.id}
              extra={e}
              locale={locale}
              tr={tr}
              canManage={canManage}
              onEdit={() => setEditing(e)}
              onDelete={() => setDeleting(e)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <ExtraModal
          mode="create"
          tr={tr}
          onClose={() => setShowCreate(false)}
          onSaved={(extra) => {
            setExtras((prev) => sortExtras([...prev, extra]));
            setShowCreate(false);
          }}
        />
      )}

      {editing && (
        <ExtraModal
          mode="edit"
          extra={editing}
          tr={tr}
          onClose={() => setEditing(null)}
          onSaved={(extra) => {
            setExtras((prev) =>
              sortExtras(prev.map((e) => (e.id === extra.id ? extra : e)))
            );
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <DeleteExtraModal
          extra={deleting}
          tr={tr}
          onClose={() => setDeleting(null)}
          onDeleted={(extra) => {
            setExtras((prev) =>
              prev.map((e) => (e.id === extra.id ? extra : e))
            );
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Κάρτα πρόσθετου
   ───────────────────────────────────────────── */

function ExtraCard({
  extra: e,
  locale,
  tr,
  canManage,
  onEdit,
  onDelete,
}: {
  extra: ExtraDTO;
  locale: string;
  tr: (key: string) => string;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = e.type === "INSURANCE" ? ShieldCheck : PackagePlus;

  return (
    <div className={`dash-vehicle ${e.isActive ? "" : "dash-vehicle--off"}`}>
      <div className="dash-vehicle-top">
        <div className="dash-vehicle-icon">
          <Icon size={20} />
        </div>
        <div className="dash-vehicle-id">
          <span className="dash-vehicle-name">{e.name}</span>
          <span className="dash-vehicle-plate dash-customer-city">
            {tr(`chargeType.${e.chargeType}`)}
          </span>
        </div>
        <span
          className={`dash-status dash-status--${
            EXTRA_TYPE_CLASS[e.type] ?? "muted"
          }`}
        >
          {tr(`extraType.${e.type}`)}
        </span>
      </div>

      {!e.isActive && (
        <div className="dash-vehicle-badges">
          <span className="dash-badge dash-badge--muted">
            {tr("extras.inactive")}
          </span>
        </div>
      )}

      <div className="dash-vehicle-foot">
        <span className="dash-vehicle-rate">
          {eur(e.price, locale)}
          <small>
            {e.chargeType === "PER_DAY"
              ? tr("extras.perDay")
              : tr("extras.oneOff")}
          </small>
        </span>
        {canManage && (
          <div className="dash-vehicle-actions">
            <button
              className="dash-icon-btn"
              onClick={onEdit}
              title={tr("extras.edit")}
              aria-label={tr("extras.edit")}
            >
              <Pencil size={16} />
            </button>
            {e.isActive && (
              <button
                className="dash-icon-btn dash-icon-btn--danger"
                onClick={onDelete}
                title={tr("extras.delete")}
                aria-label={tr("extras.delete")}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Modal δημιουργίας / επεξεργασίας
   ───────────────────────────────────────────── */

function ExtraModal({
  mode,
  extra,
  tr,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  extra?: ExtraDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onSaved: (extra: ExtraDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(
    extra ? formFromExtra(extra) : emptyForm()
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
        mode === "create" ? "/api/extras" : `/api/extras/${extra!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(form)),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("extras.errorSave"));
        return;
      }

      onSaved(data.data.extra);
    } catch {
      setError(tr("extras.errorConnection"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>
            {mode === "create" ? tr("extras.newExtra") : tr("extras.editExtra")}
          </h2>
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
            <label className="dash-field dash-field--wide">
              {tr("extras.name")} *
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                autoFocus
              />
            </label>

            {/* Ο χρήστης δηλώνει αν πρόκειται για κανονικό πρόσθετο ή ασφάλεια */}
            <label className="dash-field">
              {tr("extras.type")}
              <select
                value={form.type}
                onChange={(e) => set("type", e.target.value)}
              >
                {EXTRA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {tr(`extraType.${t}`)}
                  </option>
                ))}
              </select>
            </label>

            {/* …και αν χρεώνεται ανά ημέρα ή εφάπαξ */}
            <label className="dash-field">
              {tr("extras.chargeType")}
              <select
                value={form.chargeType}
                onChange={(e) => set("chargeType", e.target.value)}
              >
                {CHARGE_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {tr(`chargeType.${c}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field">
              {tr("extras.price")} *
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
              />
            </label>

            <label className="dash-field dash-field--check">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
              />
              {tr("extras.isActive")}
            </label>
          </div>

          {error && <div className="dash-form-error">{error}</div>}
          <p className="dash-form-note">{tr("extras.requiredNote")}</p>
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("extras.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? tr("extras.saving") : tr("extras.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Επιβεβαίωση απενεργοποίησης
   ───────────────────────────────────────────── */

function DeleteExtraModal({
  extra,
  tr,
  onClose,
  onDeleted,
}: {
  extra: ExtraDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onDeleted: (extra: ExtraDTO) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/extras/${extra.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.message || tr("extras.errorSave"));
        return;
      }

      onDeleted(data.data.extra);
    } catch {
      setError(tr("extras.errorConnection"));
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
          <h2>{tr("extras.confirmDeleteTitle")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <p className="dash-confirm-vehicle">{extra.name}</p>
          <p className="dash-form-note">{tr("extras.confirmDeleteBody")}</p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("extras.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--danger"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading ? tr("extras.deleting") : tr("extras.confirmDelete")}
          </button>
        </div>
      </div>
    </div>
  );
}
