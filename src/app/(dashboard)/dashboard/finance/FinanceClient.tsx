"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Car,
  TrendingUp,
  TrendingDown,
  Wallet,
  Receipt,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  EXPENSE_TYPES,
  monthRange,
  type DateRange,
  type ExpenseDTO,
  type FinanceSummary,
} from "@/lib/finance";

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

export interface Can {
  create: boolean;
  edit: boolean;
  delete: boolean;
}

type Mode = "MONTH" | "RANGE";

/* ─────────────────────────────────────────────
   Σελίδα
   ───────────────────────────────────────────── */

export default function FinanceClient({
  initialMonth,
  initialSummary,
  initialExpenses,
  vehicles,
  can,
}: {
  initialMonth: string;
  initialSummary: FinanceSummary;
  initialExpenses: ExpenseDTO[];
  vehicles: Option[];
  can: Can;
}) {
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("MONTH");
  const [month, setMonth] = useState(initialMonth);
  const [custom, setCustom] = useState<DateRange>(monthRange(initialMonth));
  const [typeFilter, setTypeFilter] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");

  const [summary, setSummary] = useState(initialSummary);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState<ExpenseDTO | "new" | null>(null);
  const [removing, setRemoving] = useState<ExpenseDTO | null>(null);
  const [busy, setBusy] = useState(false);

  /** Το query string της περιόδου — ίδιο για σύνοψη και λίστα. */
  const periodQuery = (): string | null => {
    if (mode === "MONTH") return month ? `month=${month}` : null;
    if (!custom.from || !custom.to) return null;
    return `from=${custom.from}&to=${custom.to}`;
  };

  // Αγνοούμε απαντήσεις παλαιότερων αιτημάτων όταν ο χρήστης αλλάζει
  // γρήγορα περίοδο.
  const requestSeq = useRef(0);
  const firstRun = useRef(true);

  const reload = useCallback(async () => {
    if (mode === "RANGE" && custom.from && custom.to && custom.to < custom.from) {
      setError(tr("finance.errorRange"));
      return;
    }
    const period = periodQuery();
    if (!period) return;

    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");

    const filters =
      (typeFilter ? `&type=${typeFilter}` : "") +
      (vehicleFilter ? `&vehicleId=${encodeURIComponent(vehicleFilter)}` : "");

    try {
      const [sRes, eRes] = await Promise.all([
        fetch(`/api/finance/summary?${period}`, { cache: "no-store" }),
        fetch(`/api/expenses?${period}${filters}`, { cache: "no-store" }),
      ]);
      const [sData, eData] = await Promise.all([sRes.json(), eRes.json()]);
      if (seq !== requestSeq.current) return;

      if (!sRes.ok || !eRes.ok) {
        setError(sData.message || eData.message || tr("finance.errorLoad"));
        return;
      }
      setSummary(sData.data.summary);
      setExpenses(eData.data.expenses);
    } catch {
      if (seq === requestSeq.current) setError(tr("finance.errorConnection"));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, month, custom.from, custom.to, typeFilter, vehicleFilter, tr]);

  useEffect(() => {
    // Η πρώτη φόρτωση ήρθε ήδη από τον server.
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    reload();
  }, [reload]);

  const afterChange = async () => {
    await reload();
    router.refresh();
  };

  const doRemove = async () => {
    if (!removing || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/expenses/${removing.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("finance.errorSave"));
        return;
      }
      setRemoving(null);
      await afterChange();
    } catch {
      setError(tr("finance.errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  const listTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const maxBreakdown = Math.max(0, ...summary.breakdown.map((b) => b.amount));

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("finance.title")}</h1>
          <p className="dash-page-sub">{tr("finance.subtitle")}</p>
        </div>
        {can.create && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={() => setEditing("new")}
          >
            <Plus size={17} /> {tr("finance.addExpense")}
          </button>
        )}
      </div>

      {/* ── Περίοδος ── */}
      <div className="dash-toolbar">
        <div className="dash-filters">
          {(["MONTH", "RANGE"] as Mode[]).map((m) => (
            <button
              key={m}
              className={`dash-filter ${mode === m ? "active" : ""}`}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
            >
              {tr(m === "MONTH" ? "finance.modeMonth" : "finance.modeRange")}
            </button>
          ))}
        </div>

        {mode === "MONTH" ? (
          <label className="dash-field dash-field--inline">
            {tr("finance.period")}
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="dash-field dash-field--inline">
              {tr("finance.from")}
              <input
                type="date"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
            </label>
            <label className="dash-field dash-field--inline">
              {tr("finance.to")}
              <input
                type="date"
                value={custom.to}
                min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </label>
          </>
        )}

        {loading && <span className="dash-count">{tr("finance.loading")}</span>}
      </div>

      {error && <div className="dash-form-error">{error}</div>}

      {/* ── Σύνοψη ── */}
      <div className="dash-kpis">
        <div className="dash-card dash-card--green">
          <div className="dash-card-icon">
            <TrendingUp size={22} />
          </div>
          <div>
            <span className="dash-card-value">{eur(summary.revenueNet, locale)}</span>
            <span className="dash-card-label">
              {tr("finance.revenue")} · <strong>{tr("finance.revenueNote")}</strong>
            </span>
            <span className="dash-card-label">
              {summary.paidInvoices} {tr("finance.paidInvoices")}
            </span>
          </div>
        </div>

        <div className="dash-card dash-card--amber">
          <div className="dash-card-icon">
            <TrendingDown size={22} />
          </div>
          <div>
            <span className="dash-card-value">{eur(summary.expensesTotal, locale)}</span>
            <span className="dash-card-label">{tr("finance.expenses")}</span>
            <span className="dash-card-label">
              {summary.expensesCount} {tr("finance.expensesCount")}
            </span>
          </div>
        </div>

        <div className={`dash-card ${summary.profit < 0 ? "dash-fin-loss" : "dash-card--indigo"}`}>
          <div className="dash-card-icon">
            <Wallet size={22} />
          </div>
          <div>
            <span className="dash-card-value">{eur(summary.profit, locale)}</span>
            <span className="dash-card-label">{tr("finance.profit")}</span>
            <span className="dash-card-label">{tr("finance.profitNote")}</span>
          </div>
        </div>
      </div>

      {/* ── Κατανομή ── */}
      <div className="dash-panel dash-fin-panel">
        <h2 className="dash-section-title">{tr("finance.breakdown")}</h2>
        {summary.expensesTotal === 0 ? (
          <p className="dash-form-note">{tr("finance.noExpensesYet")}</p>
        ) : (
          <div className="dash-fin-bars">
            {summary.breakdown
              .filter((b) => b.amount > 0)
              .map((b) => (
                <div key={b.type} className="dash-fin-bar-row">
                  <span className="dash-fin-bar-label">{tr(`expenseType.${b.type}`)}</span>
                  <div
                    className="dash-fin-bar-track"
                    role="progressbar"
                    aria-valuenow={Math.round(b.percent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="dash-fin-bar-fill"
                      style={{
                        width: `${maxBreakdown > 0 ? (b.amount / maxBreakdown) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="dash-fin-bar-amount">
                    {eur(b.amount, locale)}
                    <small> · {Math.round(b.percent)}%</small>
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ── Λίστα εξόδων ── */}
      <h2 className="dash-section-title">{tr("finance.expensesList")}</h2>
      <div className="dash-toolbar">
        <label className="dash-field dash-field--inline">
          {tr("finance.type")}
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{tr("finance.allTypes")}</option>
            {EXPENSE_TYPES.map((t) => (
              <option key={t} value={t}>
                {tr(`expenseType.${t}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="dash-field dash-field--inline">
          {tr("finance.vehicle")}
          <select
            value={vehicleFilter}
            onChange={(e) => setVehicleFilter(e.target.value)}
          >
            <option value="">{tr("finance.allVehicles")}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <span className="dash-count">
          {expenses.length} {tr("finance.records")} · {tr("finance.total")}{" "}
          {eur(listTotal, locale)}
        </span>
      </div>

      {expenses.length === 0 ? (
        <div className="dash-panel dash-empty">{tr("finance.noExpensesYet")}</div>
      ) : (
        <div className="dash-invoices">
          {expenses.map((e) => (
            <div key={e.id} className="dash-invoice">
              <div className="dash-invoice-id">
                <span className="dash-invoice-number">
                  <Receipt size={15} /> {tr(`expenseType.${e.type}`)}
                </span>
              </div>

              <div className="dash-invoice-who">
                <span className="dash-invoice-customer">
                  {shortDate(e.date, locale)}
                </span>
                {e.vehicleLabel && (
                  <span className="dash-invoice-booking">
                    <Car size={12} /> {e.vehicleLabel}
                  </span>
                )}
                {e.notes && <span className="dash-invoice-booking">{e.notes}</span>}
              </div>

              <div className="dash-invoice-money">
                <span className="dash-invoice-total">{eur(e.amount, locale)}</span>
              </div>

              <div className="dash-invoice-actions">
                {can.edit && (
                  <button
                    className="dash-icon-btn"
                    onClick={() => setEditing(e)}
                    title={tr("finance.edit")}
                    aria-label={tr("finance.edit")}
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {can.delete && (
                  <button
                    className="dash-icon-btn dash-icon-btn--danger"
                    onClick={() => setRemoving(e)}
                    title={tr("finance.delete")}
                    aria-label={tr("finance.delete")}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ExpenseModal
          expense={editing === "new" ? null : editing}
          vehicles={vehicles}
          tr={tr}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await afterChange();
          }}
        />
      )}

      {removing && (
        <div className="dash-modal-overlay" onClick={() => setRemoving(null)}>
          <div
            className="dash-modal dash-modal--sm"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="dash-modal-header">
              <h2>{tr("finance.confirmDeleteTitle")}</h2>
              <button
                className="dash-modal-close"
                onClick={() => setRemoving(null)}
                aria-label={tr("finance.cancel")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dash-modal-body">
              <p className="dash-confirm-vehicle">
                {tr(`expenseType.${removing.type}`)} · {shortDate(removing.date, locale)} ·{" "}
                {eur(removing.amount, locale)}
              </p>
              <p className="dash-form-note">{tr("finance.confirmDeleteBody")}</p>
            </div>
            <div className="dash-modal-footer">
              <button className="dash-btn" onClick={() => setRemoving(null)}>
                {tr("finance.cancel")}
              </button>
              <button
                className="dash-btn dash-btn--danger"
                onClick={doRemove}
                disabled={busy}
              >
                {tr("finance.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Φόρμα εξόδου
   ───────────────────────────────────────────── */

function ExpenseModal({
  expense,
  vehicles,
  tr,
  onClose,
  onSaved,
}: {
  expense: ExpenseDTO | null;
  vehicles: Option[];
  tr: (key: string) => string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    type: expense?.type ?? "fuel",
    amount: expense ? String(expense.amount) : "",
    date: expense?.date ?? today(),
    vehicleId: expense?.vehicleId ?? "",
    notes: expense?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (saving) return;
    const amount = Number(form.amount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(tr("finance.errorAmount"));
      return;
    }
    if (!form.date) {
      setError(tr("finance.errorDate"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch(
        expense ? `/api/expenses/${expense.id}` : "/api/expenses",
        {
          method: expense ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: form.type,
            amount,
            date: form.date,
            vehicleId: form.vehicleId || null,
            notes: form.notes.trim() || null,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("finance.errorSave"));
        return;
      }
      await onSaved();
    } catch {
      setError(tr("finance.errorConnection"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>{tr(expense ? "finance.editExpense" : "finance.newExpense")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("finance.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <div className="dash-form-grid">
            <label className="dash-field">
              {tr("finance.type")}
              <select
                value={form.type}
                onChange={(e) => set({ type: e.target.value as ExpenseDTO["type"] })}
              >
                {EXPENSE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {tr(`expenseType.${t}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field">
              {tr("finance.amount")}
              <input
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </label>

            <label className="dash-field">
              {tr("finance.date")}
              <input
                type="date"
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </label>

            <label className="dash-field">
              <span>
                <Car size={13} /> {tr("finance.vehicle")}
              </span>
              <select
                value={form.vehicleId}
                onChange={(e) => set({ vehicleId: e.target.value })}
              >
                <option value="">{tr("finance.noVehicle")}</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field dash-field--wide">
              {tr("finance.notes")}
              <textarea
                rows={3}
                maxLength={1000}
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </label>
          </div>

          <p className="dash-form-note">{tr("finance.amountNote")}</p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose}>
            {tr("finance.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? tr("finance.saving") : tr("finance.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
