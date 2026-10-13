"use client";

// Κοινά κομμάτια των καρτελών του δημόσιου site («Η σελίδα μου»).
// Καθαρό CSS (dash-*), ίδιο μοτίβο φορμών με το υπόλοιπο dashboard.

import { useState } from "react";
import { useT } from "@/lib/i18n/I18nProvider";
import { centsToInput, parseEuroInput } from "@/lib/public/money";
import type { LocalizedText } from "@/lib/public/text";

/* ─────────────────────────────────────────────
   API
   ───────────────────────────────────────────── */

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  message?: string;
}

export async function api<T>(url: string, method = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string };
    return { ok: res.ok, status: res.status, data: json.data, message: json.message };
  } catch {
    return { ok: false, status: 0 };
  }
}

/* ─────────────────────────────────────────────
   Πεδία
   ───────────────────────────────────────────── */

/** ΕΛ και EN δίπλα-δίπλα· το EN προαιρετικό. */
export function I18nInput({
  label,
  value,
  onChange,
  multiline,
  maxLength,
  required,
}: {
  label: string;
  value: LocalizedText;
  onChange: (v: LocalizedText) => void;
  multiline?: boolean;
  maxLength?: number;
  required?: boolean;
}) {
  const tr = useT();
  const field = (lang: "el" | "en") => {
    const props = {
      value: value[lang] ?? "",
      maxLength,
      onChange: (e: { target: { value: string } }) => onChange({ ...value, [lang]: e.target.value }),
    };
    return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
  };
  return (
    <div className="dash-field dash-field--wide">
      <span>
        {label}
        {required && " *"}
      </span>
      <div className="dash-ps-i18n">
        <label className="dash-ps-lang">
          <span>{tr("publicSite.el")}</span>
          {field("el")}
        </label>
        <label className="dash-ps-lang">
          <span>{tr("publicSite.en")}</span>
          {field("en")}
        </label>
      </div>
      <span className="dash-form-note">{tr("publicSite.enHint")}</span>
    </div>
  );
}

/** Ποσό σε € (κόμμα ή τελεία) → cents. Το κείμενο κρατιέται όπως γράφεται. */
export function MoneyInput({
  label,
  cents,
  onChange,
  nullable,
  hint,
  allowNegative,
}: {
  label: string;
  cents: number | null;
  onChange: (cents: number | null, valid: boolean) => void;
  nullable?: boolean;
  hint?: string;
  allowNegative?: boolean;
}) {
  const tr = useT();
  const [text, setText] = useState(centsToInput(cents));
  const parsed = parseEuroInput(text);
  const invalid =
    (parsed !== null && Number.isNaN(parsed)) ||
    (parsed === null && !nullable) ||
    (!allowNegative && parsed !== null && parsed < 0);
  return (
    <label className="dash-field">
      {label}
      <div className="dash-ps-money">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseEuroInput(e.target.value);
            const bad = (p !== null && Number.isNaN(p)) || (p === null && !nullable) || (!allowNegative && p !== null && p < 0);
            onChange(bad ? cents : p, !bad);
          }}
          aria-invalid={invalid}
        />
        <span>€</span>
      </div>
      {invalid ? (
        <span className="dash-ps-err">{tr("publicSite.errorMoney")}</span>
      ) : (
        hint && <span className="dash-form-note">{hint}</span>
      )}
    </label>
  );
}

/** Ακέραιος (ή κενό όταν nullable). */
export function IntInput({
  label,
  value,
  onChange,
  nullable,
  min,
  max,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  nullable?: boolean;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <label className="dash-field">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (v === "") onChange(nullable ? null : 0);
          else if (/^-?\d+$/.test(v)) onChange(Number(v));
        }}
      />
      {hint && <span className="dash-form-note">{hint}</span>}
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="dash-field dash-field--check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="dash-field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ─────────────────────────────────────────────
   Επιβεβαίωση διαγραφής
   ───────────────────────────────────────────── */

export function ConfirmModal({
  title,
  text,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const tr = useT();
  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal dash-modal--sm" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div className="dash-modal-header">
          <h2>{title}</h2>
        </div>
        <div className="dash-modal-body">
          <p className="dash-form-note">{text}</p>
        </div>
        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={busy}>
            {tr("publicSite.cancel")}
          </button>
          <button className="dash-btn dash-btn--danger" onClick={onConfirm} disabled={busy}>
            {tr("publicSite.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Μήνυμα αποτελέσματος κάτω από μια φόρμα. */
export function Status({ error, saved }: { error: string; saved: boolean }) {
  const tr = useT();
  if (error) return <div className="dash-form-error">{error}</div>;
  if (saved) return <div className="dash-alert-ok dash-settings-saved">✓ {tr("publicSite.saved")}</div>;
  return null;
}
