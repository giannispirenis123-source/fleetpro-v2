"use client";

import { formatEuros } from "@/lib/public/money";
import { useMemo, useState } from "react";
import { Plus, Search, Pencil, Ban, X, Tag, User, Calendar, Handshake } from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  DISCOUNT_TYPES,
  DISCOUNT_STATE_CLASS,
  discountState,
  type DiscountDTO,
} from "@/lib/discountsShared";

const INTL_LOCALE: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) => formatEuros(n, locale);

const shortDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? "el-GR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));

interface Option {
  id: string;
  label: string;
}

type Filter = "ALL" | "ACTIVE" | "INACTIVE";

/** Συνεργάτης της εταιρίας (για τη λίστα της φόρμας και την κάρτα). */
interface PartnerOption {
  id: string;
  name: string;
  isActive: boolean;
  /** Το ΤΡΕΧΟΝ ποσοστό προμήθειας (%). */
  rate: number;
}

const pctLabel = (n: number, locale: string) => `${String(n).replace(".", locale === "en" ? "." : ",")}%`;

interface FormState {
  code: string;
  name: string;
  type: string;
  value: string;
  isActive: boolean;
  validFrom: string;
  validUntil: string;
  usageLimit: string;
  target: string;
  targetValue: string;
  /** "" = κωδικός της εταιρίας. */
  partnerId: string;
}

const emptyForm = (): FormState => ({
  code: "",
  name: "",
  type: "PERCENTAGE",
  value: "",
  isActive: true,
  validFrom: "",
  validUntil: "",
  usageLimit: "",
  target: "ALL",
  targetValue: "",
  partnerId: "",
});

const formFromDiscount = (d: DiscountDTO): FormState => ({
  code: d.code ?? "",
  name: d.name,
  type: d.type,
  value: String(d.value),
  isActive: d.isActive,
  validFrom: d.validFrom ?? "",
  validUntil: d.validUntil ?? "",
  usageLimit: d.usageLimit === null ? "" : String(d.usageLimit),
  target: d.target === "CUSTOMER" ? "CUSTOMER" : "ALL",
  targetValue: d.targetValue ?? "",
  partnerId: d.partnerId ?? "",
});

export default function DiscountsClient({
  initialDiscounts,
  customers,
  partners = [],
  can = { create: true, edit: true, delete: true },
}: {
  initialDiscounts: DiscountDTO[];
  customers: Option[];
  /** Οι συνεργάτες της εταιρίας (ο συνεργάτης-θεατής: μόνο ο ίδιος). */
  partners?: PartnerOption[];
  /** Τι επιτρέπεται (ο server το ξαναελέγχει· ο συνεργάτης: τίποτα — μόνο ανάγνωση). */
  can?: { create: boolean; edit: boolean; delete: boolean };
}) {
  const tr = useT();
  const locale = useLocale();

  const [discounts, setDiscounts] = useState<DiscountDTO[]>(initialDiscounts);

  // Το API επιστρέφει μόνο το targetValue (id). Το όνομα το ξέρει ήδη η
  // σελίδα, οπότε δεν περιμένουμε reload για να εμφανιστεί σωστά.
  const nameById = useMemo(
    () => new Map(customers.map((c) => [c.id, c.label])),
    [customers]
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<DiscountDTO | null>(null);
  const [deactivating, setDeactivating] = useState<DiscountDTO | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return discounts.filter((d) => {
      const matchesFilter =
        filter === "ALL" ||
        (filter === "ACTIVE" ? d.isActive : !d.isActive);
      const matchesSearch =
        !q ||
        [d.code ?? "", d.name, d.customerName ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [discounts, search, filter]);

  const upsert = (d: DiscountDTO) =>
    setDiscounts((prev) => {
      const exists = prev.some((x) => x.id === d.id);
      return exists ? prev.map((x) => (x.id === d.id ? d : x)) : [d, ...prev];
    });

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("discounts.title")}</h1>
          <p className="dash-page-sub">{tr("discounts.subtitle")}</p>
        </div>
        {can.create && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={() => setShowCreate(true)}
            data-testid="discount-add"
          >
            <Plus size={17} /> {tr("discounts.addDiscount")}
          </button>
        )}
      </div>

      <div className="dash-toolbar">
        <div className="dash-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("discounts.searchPlaceholder")}
          />
        </div>
        <div className="dash-filters">
          {(["ALL", "ACTIVE", "INACTIVE"] as Filter[]).map((f) => (
            <button
              key={f}
              className={`dash-filter ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {tr(`discounts.filter${f}`)}
            </button>
          ))}
        </div>
        <span className="dash-count">
          {visible.length}{" "}
          {visible.length === 1
            ? tr("discounts.countOne")
            : tr("discounts.count")}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="dash-panel dash-empty">
          {discounts.length === 0
            ? tr("discounts.empty")
            : tr("discounts.emptyFiltered")}
        </div>
      ) : (
        <div className="dash-vehicles">
          {visible.map((d) => (
            <DiscountCard
              key={d.id}
              discount={d}
              locale={locale}
              tr={tr}
              customerLabel={
                d.target === "CUSTOMER"
                  ? nameById.get(d.targetValue ?? "") ??
                    d.customerName ??
                    tr("discounts.targetCustomer")
                  : null
              }
              partner={d.partnerId ? partners.find((p) => p.id === d.partnerId) ?? null : null}
              onEdit={can.edit ? () => setEditing(d) : null}
              onDeactivate={can.delete ? () => setDeactivating(d) : null}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <DiscountModal
          mode="create"
          tr={tr}
          customers={customers}
          partners={partners}
          onClose={() => setShowCreate(false)}
          onSaved={(d) => {
            upsert(d);
            setShowCreate(false);
          }}
        />
      )}

      {editing && (
        <DiscountModal
          mode="edit"
          discount={editing}
          tr={tr}
          customers={customers}
          partners={partners}
          onClose={() => setEditing(null)}
          onSaved={(d) => {
            upsert(d);
            setEditing(null);
          }}
        />
      )}

      {deactivating && (
        <DeactivateModal
          discount={deactivating}
          tr={tr}
          onClose={() => setDeactivating(null)}
          onDone={(d) => {
            upsert(d);
            setDeactivating(null);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Κάρτα κωδικού
   ───────────────────────────────────────────── */

function DiscountCard({
  discount: d,
  locale,
  tr,
  customerLabel,
  partner,
  onEdit,
  onDeactivate,
}: {
  discount: DiscountDTO;
  locale: string;
  tr: (key: string) => string;
  /** null όταν ο κωδικός ισχύει για όλους. */
  customerLabel: string | null;
  /** Ο συνεργάτης στον οποίο ανατέθηκε (null = κωδικός της εταιρίας). */
  partner: PartnerOption | null;
  /** null = δεν επιτρέπεται (π.χ. συνεργάτης: μόνο ανάγνωση). */
  onEdit: (() => void) | null;
  onDeactivate: (() => void) | null;
}) {
  const state = discountState(d);

  return (
    <div className="dash-vehicle">
      <div className="dash-vehicle-top">
        <div className="dash-vehicle-icon">
          <Tag size={20} />
        </div>
        <div className="dash-vehicle-id">
          <span className="dash-vehicle-name dash-code">{d.code}</span>
          <span className="dash-vehicle-plate dash-customer-city">{d.name}</span>
        </div>
        <span className={`dash-status dash-status--${DISCOUNT_STATE_CLASS[state]}`}>
          {tr(`discounts.state${state}`)}
        </span>
      </div>

      <div className="dash-vehicle-specs">
        <span className="dash-discount-value">
          {d.type === "PERCENTAGE" ? `−${d.value}%` : `−${eur(d.value, locale)}`}
        </span>
        <span>
          <User size={13} /> {customerLabel ?? tr("discounts.targetAll")}
        </span>
        {d.partnerId && (
          <span data-testid="discount-partner">
            <Handshake size={13} />{" "}
            {tr("discounts.cardPartner")
              .replace("{name}", partner?.name ?? tr("common.deletedUser"))
              .replace("{rate}", partner ? pctLabel(partner.rate, locale) : "—")}
            {partner && !partner.isActive ? ` · ${tr("discounts.partnerInactive")}` : ""}
          </span>
        )}
        {/* Ο κωδικός ΑΠΟΡΡΙΠΤΕΤΑΙ στο site (π.χ. η προμήθεια μειώθηκε κάτω από την έκπτωση). */}
        {d.partnerId && d.isActive && (!partner || !partner.isActive || d.type !== "PERCENTAGE" || d.value > partner.rate + 1e-9) && (
          <span className="dash-form-error" data-testid="discount-partner-warning">
            {tr("discounts.partnerWarning")}
          </span>
        )}
        {(d.validFrom || d.validUntil) && (
          <span>
            <Calendar size={13} />{" "}
            {d.validFrom ? shortDate(d.validFrom, locale) : "…"} →{" "}
            {d.validUntil ? shortDate(d.validUntil, locale) : "…"}
          </span>
        )}
      </div>

      <div className="dash-vehicle-foot">
        <span className="dash-usage">
          {tr("discounts.uses")}:{" "}
          <strong>
            {d.usageCount}
            {d.usageLimit !== null ? ` / ${d.usageLimit}` : ""}
          </strong>
          {d.usageLimit === null && (
            <small> · {tr("discounts.unlimited")}</small>
          )}
        </span>
        <div className="dash-vehicle-actions">
          {onEdit && (
          <button
            className="dash-icon-btn"
            onClick={onEdit}
            title={tr("discounts.edit")}
            aria-label={tr("discounts.edit")}
          >
            <Pencil size={16} />
          </button>
          )}
          {d.isActive && onDeactivate && (
            <button
              className="dash-icon-btn dash-icon-btn--danger"
              onClick={onDeactivate}
              title={tr("discounts.deactivate")}
              aria-label={tr("discounts.deactivate")}
            >
              <Ban size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Modal δημιουργίας / επεξεργασίας
   ───────────────────────────────────────────── */

function DiscountModal({
  mode,
  discount,
  tr,
  customers,
  partners,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  discount?: DiscountDTO;
  tr: (key: string) => string;
  customers: Option[];
  partners: PartnerOption[];
  onClose: () => void;
  onSaved: (d: DiscountDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(
    discount ? formFromDiscount(discount) : emptyForm()
  );
  const locale = useLocale();
  // Ανάθεση σε συνεργάτη: μόνο ποσοστό, για όλους, ως την ΤΡΕΧΟΥΣΑ προμήθειά
  // του (ο server το επιβάλλει ξανά). Στη λίστα ΜΟΝΟ ενεργοί συνεργάτες
  // (+ ο ήδη ανατεθειμένος, για να φαίνεται).
  const chosen = form.partnerId ? partners.find((p) => p.id === form.partnerId) ?? null : null;
  const isPartner = !!form.partnerId;
  const partnerMaxPercent = chosen ? chosen.rate : null;
  const maxLabel = chosen ? pctLabel(chosen.rate, locale) : "";
  const partnerChoices = partners.filter((p) => p.isActive || p.id === discount?.partnerId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError(tr("discounts.errorMissing"));
      return;
    }
    const value = Number(form.value);
    if (!value || value <= 0) {
      setError(tr("discounts.errorValue"));
      return;
    }
    if (form.target === "CUSTOMER" && !form.targetValue) {
      setError(tr("discounts.errorCustomer"));
      return;
    }
    if (isPartner && form.isActive) {
      if (!chosen || !chosen.isActive) {
        setError(tr("discounts.partnerNotActive"));
        return;
      }
      if (form.type !== "PERCENTAGE" || value > partnerMaxPercent! + 1e-9) {
        setError(tr(form.type !== "PERCENTAGE" ? "discounts.partnerPercentOnly" : "discounts.partnerOverCommission").replace("{max}", maxLabel));
        return;
      }
    }

    setLoading(true);
    setError("");

    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        type: form.type,
        value,
        isActive: form.isActive,
        validFrom: form.validFrom || null,
        validUntil: form.validUntil || null,
        usageLimit: form.usageLimit === "" ? null : Number(form.usageLimit),
        target: form.target,
        targetValue: form.target === "CUSTOMER" ? form.targetValue : null,
        partnerId: form.partnerId || null,
      };

      const res = await fetch(
        mode === "create" ? "/api/discounts" : `/api/discounts/${discount!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("discounts.errorSave"));
        return;
      }

      onSaved(data.data.discount);
    } catch {
      setError(tr("discounts.errorConnection"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>
            {mode === "create"
              ? tr("discounts.newDiscount")
              : tr("discounts.editDiscount")}
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
            <label className="dash-field">
              {tr("discounts.code")} *
              <input
                value={form.code}
                onChange={(e) => set("code", e.target.value.toUpperCase())}
                placeholder="SUMMER25"
              />
            </label>
            <label className="dash-field dash-field--wide">
              {tr("discounts.name")} *
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={tr("discounts.namePlaceholder")}
              />
            </label>

            <label className="dash-field dash-field--wide">
              {tr("discounts.partner")}
              <select
                value={form.partnerId}
                data-testid="discount-partner-select"
                onChange={(e) => {
                  const id = e.target.value;
                  setForm((f) => ({
                    ...f,
                    partnerId: id,
                    // Με συνεργάτη: μόνο ποσοστό, για όλους τους πελάτες.
                    ...(id ? { type: "PERCENTAGE", target: "ALL", targetValue: "" } : {}),
                  }));
                }}
              >
                <option value="">{tr("discounts.partnerNone")}</option>
                {partnerChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {pctLabel(p.rate, locale)}
                    {p.isActive ? "" : ` (${tr("discounts.partnerInactive")})`}
                  </option>
                ))}
              </select>
              <small className="dash-form-note">{tr(isPartner ? "discounts.partnerHint" : "discounts.partnerNoneHint")}</small>
            </label>

            <label className="dash-field">
              {tr("discounts.type")}
              <select
                value={form.type}
                onChange={(e) => set("type", e.target.value)}
              >
                {DISCOUNT_TYPES.filter((t) => !isPartner || t === "PERCENTAGE" || t === form.type).map((t) => (
                  <option key={t} value={t}>
                    {tr(`discounts.type${t}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="dash-field">
              {form.type === "PERCENTAGE"
                ? tr("discounts.valuePercent")
                : tr("discounts.valueAmount")}{" "}
              *
              <input
                type="number"
                min={0}
                max={form.type === "PERCENTAGE" ? (isPartner ? partnerMaxPercent! : 100) : undefined}
                step={form.type === "PERCENTAGE" ? 1 : 0.5}
                inputMode="decimal"
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
                data-testid="discount-value"
              />
              {isPartner && chosen && (
                <small className="dash-form-note" data-testid="discount-max">
                  {tr("discounts.partnerMax").replace("{max}", maxLabel)}
                </small>
              )}
            </label>

            <label className="dash-field">
              {tr("discounts.validFrom")}
              <input
                type="date"
                value={form.validFrom}
                onChange={(e) => set("validFrom", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("discounts.validUntil")}
              <input
                type="date"
                value={form.validUntil}
                onChange={(e) => set("validUntil", e.target.value)}
              />
            </label>

            <label className="dash-field">
              {tr("discounts.usageLimit")}
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={form.usageLimit}
                onChange={(e) => set("usageLimit", e.target.value)}
                placeholder={tr("discounts.unlimited")}
              />
            </label>

            {!isPartner && (
            <label className="dash-field">
              {tr("discounts.target")}
              <select
                value={form.target}
                onChange={(e) => {
                  set("target", e.target.value);
                  if (e.target.value === "ALL") set("targetValue", "");
                }}
              >
                <option value="ALL">{tr("discounts.targetAll")}</option>
                <option value="CUSTOMER">{tr("discounts.targetCustomer")}</option>
              </select>
            </label>
            )}

            {form.target === "CUSTOMER" && (
              <label className="dash-field dash-field--wide">
                {tr("discounts.customer")} *
                <select
                  value={form.targetValue}
                  onChange={(e) => set("targetValue", e.target.value)}
                >
                  <option value="">{tr("discounts.selectCustomer")}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="dash-field dash-field--wide dash-check">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
              />
              {tr("discounts.isActive")}
            </label>
          </div>

          <p className="dash-form-note">{tr("discounts.datesNote")}</p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("discounts.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? tr("discounts.saving") : tr("discounts.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Επιβεβαίωση απενεργοποίησης
   ───────────────────────────────────────────── */

function DeactivateModal({
  discount,
  tr,
  onClose,
  onDone,
}: {
  discount: DiscountDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onDone: (d: DiscountDTO) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handle = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/discounts/${discount.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("discounts.errorSave"));
        return;
      }
      onDone(data.data.discount);
    } catch {
      setError(tr("discounts.errorConnection"));
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
          <h2>{tr("discounts.confirmDeactivateTitle")}</h2>
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
            {discount.code} · {discount.name}
          </p>
          <p className="dash-form-note">
            {tr("discounts.confirmDeactivateBody")}
          </p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("discounts.back")}
          </button>
          <button
            className="dash-btn dash-btn--danger"
            onClick={handle}
            disabled={loading}
          >
            {loading ? tr("discounts.saving") : tr("discounts.deactivate")}
          </button>
        </div>
      </div>
    </div>
  );
}
