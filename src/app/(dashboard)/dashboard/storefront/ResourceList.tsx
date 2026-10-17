"use client";

// Λίστα + φόρμα για τις «λίστες» του site (ομάδες, τοποθεσίες, σεζόν, ηλικίες):
// /api/public-site/{resource}. Η φόρμα στέλνει ΟΛΗ την εγγραφή· ο server
// (zod) κρατά μόνο τα γνωστά πεδία. Διαγραφή με επιβεβαίωση· αν η εγγραφή
// χρησιμοποιείται, ο server την κάνει «Ανενεργή».

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { ConfirmModal, Status, api } from "./ui";

export interface FormApi<T> {
  value: T;
  set: <K extends keyof T>(key: K, v: T[K]) => void;
  /** Πεδίο με άκυρη τιμή (π.χ. ποσό): κλειδώνει την αποθήκευση. */
  markInvalid: (key: string, bad: boolean) => void;
  /** null σε νέα εγγραφή (π.χ. φωτογραφίες μόνο μετά την αποθήκευση). */
  saved: (T & { id: string }) | null;
}

export default function ResourceList<T extends object>({
  resource,
  intro,
  empty,
  title,
  summary,
  renderForm,
  onItems,
  quickEdit,
  copy,
  extraActions,
  movable,
}: {
  resource: string;
  intro: string;
  empty: () => T;
  title: (item: T & { id: string }) => string;
  summary: (item: T & { id: string }) => React.ReactNode;
  renderForm: (form: FormApi<T>) => React.ReactNode;
  onItems?: (items: (T & { id: string })[]) => void;
  /** Γρήγορη επεξεργασία μέσα στη λίστα (π.χ. ποσά τοποθεσίας), χωρίς όλη τη φόρμα. */
  quickEdit?: {
    label: string;
    render: (item: T & { id: string }, save: (next: T & { id: string }) => Promise<string | null>, close: () => void) => React.ReactNode;
  };
  /** «Αντιγραφή»: νέα εγγραφή από μια υπάρχουσα (π.χ. προσφορά). */
  copy?: (item: T & { id: string }) => T;
  /** Επιπλέον κουμπιά ανά γραμμή· `save` αποθηκεύει όλη την εγγραφή. */
  extraActions?: (item: T & { id: string }, save: (next: T & { id: string }) => Promise<string | null>) => React.ReactNode;
  /** «Πάνω/Κάτω» (POST {resource}/{id}/move) — η σειρά της λίστας είναι η σειρά στο site. */
  movable?: boolean;
}) {
  const tr = useT();
  const url = `/api/public-site/${resource}`;
  const [items, setItems] = useState<(T & { id: string })[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<{ value: T; id: string | null } | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<(T & { id: string }) | null>(null);
  const [quickId, setQuickId] = useState<string | null>(null);

  const update = useCallback(
    (next: (T & { id: string })[]) => {
      setItems(next);
      onItems?.(next);
    },
    [onItems]
  );

  useEffect(() => {
    let cancelled = false;
    api<{ items: (T & { id: string })[] }>(url).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) update(r.data.items);
      else setLoadError(r.message || tr("publicSite.errorLoad"));
    });
    return () => {
      cancelled = true;
    };
  }, [url, tr, update]);

  const open = (item: (T & { id: string }) | null) => {
    setError("");
    setNotice("");
    setInvalid(new Set());
    setDraft(item ? { value: item, id: item.id } : { value: empty(), id: null });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    const r = await api<{ item: T & { id: string } }>(draft.id ? `${url}/${draft.id}` : url, draft.id ? "PATCH" : "POST", draft.value);
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.message || (r.status ? tr("publicSite.errorSave") : tr("publicSite.errorConnection")));
      return;
    }
    const saved = r.data.item;
    const list = items ?? [];
    update(list.some((i) => i.id === saved.id) ? list.map((i) => (i.id === saved.id ? saved : i)) : [...list, saved]);
    // Νέα εγγραφή: μένει ανοιχτή (π.χ. για φωτογραφίες ομάδας).
    if (draft.id) setDraft(null);
    else setDraft({ value: saved, id: saved.id });
    setNotice(tr("publicSite.saved"));
  };

  /** Αποθήκευση ΟΛΗΣ της εγγραφής από τη λίστα (γρήγορη επεξεργασία, διακόπτες). */
  const saveItem = async (next: T & { id: string }): Promise<string | null> => {
    const { id, ...body } = next;
    const r = await api<{ item: T & { id: string } }>(`${url}/${id}`, "PATCH", body);
    if (!r.ok || !r.data) return r.message || tr("publicSite.errorSave");
    const saved = r.data.item;
    update((items ?? []).map((i) => (i.id === saved.id ? saved : i)));
    setNotice(tr("publicSite.saved"));
    return null;
  };

  const move = async (id: string, dir: "up" | "down") => {
    setBusy(true);
    setError("");
    const r = await api<{ items: (T & { id: string })[] }>(`${url}/${id}/move`, "POST", { dir });
    setBusy(false);
    if (r.ok && r.data) update(r.data.items);
    else setError(r.message || tr("publicSite.errorSave"));
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const r = await api<{ deleted?: boolean; deactivated?: boolean; item?: T & { id: string } }>(`${url}/${deleting.id}`, "DELETE");
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.message || tr("publicSite.errorSave"));
      setDeleting(null);
      return;
    }
    const list = items ?? [];
    if (r.data.deactivated && r.data.item) {
      const it = r.data.item;
      update(list.map((i) => (i.id === it.id ? it : i)));
      setNotice(tr("publicSite.deactivated"));
    } else {
      update(list.filter((i) => i.id !== deleting.id));
      setNotice("");
    }
    setDeleting(null);
  };

  const form: FormApi<T> | null = draft
    ? {
        value: draft.value,
        set: (key, v) => setDraft((d) => (d ? { ...d, value: { ...d.value, [key]: v } } : d)),
        markInvalid: (key, bad) =>
          setInvalid((prev) => {
            if (prev.has(key) === bad) return prev;
            const next = new Set(prev);
            if (bad) next.add(key);
            else next.delete(key);
            return next;
          }),
        saved: draft.id ? ({ ...draft.value, id: draft.id } as T & { id: string }) : null,
      }
    : null;

  return (
    <div className="dash-panel dash-settings-panel">
      <div className="dash-ps-head">
        <p className="dash-form-note dash-settings-lead">{intro}</p>
        {!draft && (
          <button className="dash-btn dash-btn--primary" onClick={() => open(null)}>
            <Plus size={16} /> {tr("publicSite.add")}
          </button>
        )}
      </div>

      {loadError && <div className="dash-form-error">{loadError}</div>}
      {!items && !loadError && <p className="dash-form-note">{tr("publicSite.loading")}</p>}
      {!draft && notice && <div className="dash-alert-ok dash-settings-saved">{notice}</div>}
      {!draft && error && <div className="dash-form-error">{error}</div>}

      {draft && form ? (
        <div className="dash-ps-form">
          <div className="dash-form-grid">{renderForm(form)}</div>
          <Status error={error} saved={!!notice && !error} />
          <div className="dash-ps-actions">
            <button className="dash-btn" onClick={() => setDraft(null)} disabled={busy}>
              {tr("publicSite.cancel")}
            </button>
            <button className="dash-btn dash-btn--primary" onClick={save} disabled={busy || invalid.size > 0}>
              {busy ? tr("publicSite.saving") : tr("publicSite.save")}
            </button>
          </div>
        </div>
      ) : (
        items && (
          <ul className="dash-ps-list">
            {items.length === 0 && <li className="dash-form-note">{tr("publicSite.empty")}</li>}
            {items.map((item, index) => (
              <li key={item.id} className="dash-ps-item">
                <div className="dash-ps-item-main">
                  <strong>{title(item)}</strong>
                  <div className="dash-ps-item-sub">{summary(item)}</div>
                </div>
                <div className="dash-ps-item-actions">
                  {movable && (
                    <>
                      <button
                        className="dash-icon-btn"
                        onClick={() => move(item.id, "up")}
                        disabled={busy || index === 0}
                        aria-label={tr("publicSite.moveUp")}
                        title={tr("publicSite.moveUp")}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        className="dash-icon-btn"
                        onClick={() => move(item.id, "down")}
                        disabled={busy || index === items.length - 1}
                        aria-label={tr("publicSite.moveDown")}
                        title={tr("publicSite.moveDown")}
                      >
                        <ArrowDown size={15} />
                      </button>
                    </>
                  )}
                  {extraActions?.(item, saveItem)}
                  {quickEdit && (
                    <button
                      className={`dash-btn dash-btn--sm ${quickId === item.id ? "is-on" : ""}`}
                      onClick={() => setQuickId(quickId === item.id ? null : item.id)}
                      aria-label={quickEdit.label}
                      title={quickEdit.label}
                    >
                      <Zap size={14} /> <span className="dash-ps-hide-xs">{quickEdit.label}</span>
                    </button>
                  )}
                  {copy && (
                    <button
                      className="dash-btn dash-btn--sm"
                      onClick={() => {
                        setError("");
                        setNotice("");
                        setInvalid(new Set());
                        setDraft({ value: copy(item), id: null });
                      }}
                      aria-label={tr("publicSite.copy")}
                      title={tr("publicSite.copy")}
                    >
                      <Copy size={14} />
                    </button>
                  )}
                  <button className="dash-btn dash-btn--sm" onClick={() => open(item)} aria-label={tr("publicSite.edit")}>
                    <Pencil size={14} /> <span className="dash-ps-hide-xs">{tr("publicSite.edit")}</span>
                  </button>
                  <button
                    className="dash-btn dash-btn--sm"
                    onClick={() => {
                      setError("");
                      setDeleting(item);
                    }}
                    aria-label={tr("publicSite.delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {quickEdit && quickId === item.id && (
                  <div className="dash-ps-quick">{quickEdit.render(item, saveItem, () => setQuickId(null))}</div>
                )}
              </li>
            ))}
          </ul>
        )
      )}

      {deleting && (
        <ConfirmModal
          title={`${tr("publicSite.confirmDelete")} ${title(deleting)}`}
          text={tr("publicSite.confirmDeleteText")}
          busy={busy}
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
