"use client";

// src/app/(dashboard)/dashboard/bookings/BookingDecision.tsx
// Τα παράθυρα «Επιβεβαίωση», «Ακύρωση» και «Μήνυμα» μιας κράτησης.
//
// Το κείμενο του μηνύματος βγαίνει ΕΔΩ με την ίδια συνάρτηση που χρησιμοποιεί
// ο server για το email (buildBookingMessage), από στοιχεία που δίνει ο server
// (GET /api/bookings/[id]/decision) — ό,τι βλέπει ο χρήστης είναι ό,τι φεύγει.

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Mail, X } from "lucide-react";
import type { BookingDTO } from "@/lib/bookings";
import {
  CANCEL_NOTE_MAX,
  CANCEL_REASONS,
  buildBookingMessage,
  kindForStatus,
  mailtoLink,
  whatsappLink,
  type MessageData,
  type MessageKind,
} from "@/lib/bookingMessages";

type Tr = (key: string) => string;

interface DecisionInfo {
  status: string;
  fromSite: boolean;
  currentVehicleId: string | null;
  currentVehicleFree: boolean;
  freeVehicles: { id: string; label: string }[];
  message: Omit<MessageData, "kind">;
  contact: { email: string | null; phone: string | null };
  notifications: { kind: string; channel: string; result: string; error: string | null; createdAt: string }[];
  history: { action: string; at: string; by: string | null }[];
}

function useDecisionInfo(bookingId: string, tr: Tr) {
  const [info, setInfo] = useState<DecisionInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/bookings/${bookingId}/decision`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok) setInfo(body.data as DecisionInfo);
        else setError(body.message || tr("bookings.errorSave"));
      } catch {
        if (alive) setError(tr("bookings.errorConnection"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // Μία φόρτωση ανά άνοιγμα — το tr δεν αλλάζει τα δεδομένα.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);
  return { info, error, loading };
}

const fmtWhen = (iso: string, locale: string) => {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "el-GR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
};

function Shell({ title, onClose, tr, children, footer }: { title: string; onClose: () => void; tr: Tr; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal dash-modal--sm" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>{title}</h2>
          <button className="dash-modal-close" onClick={onClose} aria-label={tr("common.close")}>
            <X size={18} />
          </button>
        </div>
        <div className="dash-modal-body dash-decision">{children}</div>
        <div className="dash-modal-footer">{footer}</div>
      </div>
    </div>
  );
}

function Preview({ text, lang, tr }: { text: string; lang: string; tr: Tr }) {
  return (
    <div className="dash-msg-preview">
      <div className="dash-msg-preview-head">
        <span>{tr("decision.decisionPreview")}</span>
        <span className="dash-badge dash-badge--muted">
          {tr("decision.decisionPreviewLang")}: {lang.toUpperCase()}
        </span>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

function emailNotice(email: string, error: string | null, tr: Tr): { tone: "ok" | "warn"; text: string } | null {
  switch (email) {
    case "sent":
      return { tone: "ok", text: tr("decision.emailSent") };
    case "already_sent":
      return { tone: "ok", text: tr("decision.emailAlready") };
    case "no_email":
      return { tone: "warn", text: `${tr("decision.emailNoAddress")} ${tr("decision.emailUseManual")}` };
    case "not_configured":
      return { tone: "warn", text: `${tr("decision.emailNotSent")} ${tr("decision.emailNotConfigured")} ${tr("decision.emailUseManual")}` };
    case "failed":
      return { tone: "warn", text: `${tr("decision.emailNotSent")}${error ? ` (${error})` : ""} ${tr("decision.emailUseManual")}` };
    default:
      return null;
  }
}

/* ─────────────────────────────────────────────
   Επιβεβαίωση / Ακύρωση
   ───────────────────────────────────────────── */

export function DecisionModal({
  booking,
  action,
  tr,
  onClose,
  onDone,
}: {
  booking: BookingDTO;
  action: "confirm" | "cancel";
  tr: Tr;
  onClose: () => void;
  onDone: (booking: BookingDTO) => void;
}) {
  const { info, error: loadError, loading } = useDecisionInfo(booking.id, tr);
  const [vehicleId, setVehicleId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ booking: BookingDTO; notice: ReturnType<typeof emailNotice> } | null>(null);

  // Προεπιλογή: το τρέχον όχημα αν είναι ελεύθερο, αλλιώς το πρώτο ελεύθερο.
  useEffect(() => {
    if (!info) return;
    setVehicleId(info.currentVehicleFree && info.currentVehicleId ? info.currentVehicleId : info.freeVehicles[0]?.id ?? "");
  }, [info]);

  const hasEmail = !!info?.contact.email;
  const message = useMemo(() => {
    if (!info) return null;
    return buildBookingMessage({
      ...info.message,
      kind: action,
      reasonCode: action === "cancel" ? reasonCode || null : null,
      note: action === "cancel" ? note : null,
    });
  }, [info, action, reasonCode, note]);

  const noVehicle = action === "confirm" && !!info && info.freeVehicles.length === 0;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body =
        action === "confirm"
          ? { action, vehicleId: vehicleId || undefined, notify: notify && hasEmail }
          : { action, reasonCode: reasonCode || null, note: note.trim() || null, notify: notify && hasEmail };
      const res = await fetch(`/api/bookings/${booking.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("bookings.errorSave"));
        return;
      }
      const updated = data.data.booking as BookingDTO | null;
      const notice = notify ? emailNotice(data.data.email, data.data.emailError, tr) : null;
      if (updated) onDone(updated);
      if (notice && notice.tone === "warn") setDone({ booking: updated ?? booking, notice });
      else onClose();
    } catch {
      setError(tr("bookings.errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  const title = action === "confirm" ? tr("decision.decisionConfirmTitle") : tr("decision.decisionCancelTitle");

  if (done) {
    return (
      <Shell
        title={title}
        onClose={onClose}
        tr={tr}
        footer={
          <button className="dash-btn dash-btn--primary" onClick={onClose}>
            {tr("common.close")}
          </button>
        }
      >
        <div className="dash-alert dash-alert--info">
          {action === "confirm" ? tr("decision.decisionConfirmed") : tr("decision.decisionCancelled")}
        </div>
        {done.notice && <div className="dash-alert dash-alert--warn">{done.notice.text}</div>}
      </Shell>
    );
  }

  return (
    <Shell
      title={title}
      onClose={onClose}
      tr={tr}
      footer={
        <>
          <button className="dash-btn" onClick={onClose} disabled={busy}>
            {tr("bookings.back")}
          </button>
          <button
            className={`dash-btn ${action === "confirm" ? "dash-btn--primary" : "dash-btn--danger"}`}
            onClick={submit}
            disabled={busy || loading || !info || noVehicle || (action === "confirm" && !vehicleId)}
          >
            {busy ? tr("decision.decisionWorking") : action === "confirm" ? tr("decision.decisionDoConfirm") : tr("decision.decisionDoCancel")}
          </button>
        </>
      }
    >
      <p className="dash-confirm-vehicle">
        {booking.bookingNumber} · {booking.customerName}
        {booking.publicCode && <code className="dash-code"> {booking.publicCode}</code>}
      </p>

      {loading && <p className="dash-form-note">{tr("decision.decisionLoading")}</p>}
      {loadError && <div className="dash-form-error">{loadError}</div>}

      {info && action === "confirm" && (
        noVehicle ? (
          <div className="dash-alert dash-alert--danger" role="alert">
            {tr("decision.decisionNoVehicle")}
          </div>
        ) : (
          <label className="dash-field">
            {tr("decision.decisionVehicle")}
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {info.freeVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <small className="dash-form-note">{tr("decision.decisionVehicleHint")}</small>
          </label>
        )
      )}

      {info && action === "cancel" && (
        <>
          <label className="dash-field">
            {tr("decision.decisionReason")}
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">{tr("decision.decisionReasonNone")}</option>
              {CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {tr(`decision.reason_${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="dash-field">
            {tr("decision.decisionNote")}
            <textarea rows={2} maxLength={CANCEL_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </>
      )}

      {info && !noVehicle && (
        <>
          <label className="dash-field dash-field--check">
            <input type="checkbox" checked={notify && hasEmail} disabled={!hasEmail} onChange={(e) => setNotify(e.target.checked)} />
            {tr("decision.decisionNotify")}
          </label>
          {!hasEmail && <p className="dash-form-note">{tr("decision.decisionNoEmail")}</p>}
          {notify && hasEmail && message && <Preview text={message.text} lang={message.lang} tr={tr} />}
        </>
      )}

      {error && (
        <div className="dash-form-error" role="alert">
          {error}
        </div>
      )}
    </Shell>
  );
}

/* ─────────────────────────────────────────────
   Μήνυμα (χειροκίνητη αποστολή) + ιστορικό
   ───────────────────────────────────────────── */

export function MessageModal({
  booking,
  tr,
  locale,
  onClose,
  onLogged,
}: {
  booking: BookingDTO;
  tr: Tr;
  locale: string;
  onClose: () => void;
  onLogged: (kind: MessageKind) => void;
}) {
  const { info, error, loading } = useDecisionInfo(booking.id, tr);
  const kind = kindForStatus(info?.status ?? booking.status);
  const message = useMemo(
    () => (info && kind ? buildBookingMessage({ ...info.message, kind }) : null),
    [info, kind]
  );
  const wa = message && info ? whatsappLink(info.contact.phone, message.text) : null;
  const mail = message && info ? mailtoLink(info.contact.email, message.subject, message.text) : null;

  const log = (channel: "whatsapp" | "mailto") => {
    if (!kind) return;
    // Η καταγραφή δεν καθυστερεί το άνοιγμα της εφαρμογής.
    void fetch(`/api/bookings/${booking.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, channel }),
      keepalive: true,
    }).then((r) => r.ok && onLogged(kind));
  };

  return (
    <Shell
      title={tr("decision.messageTitle")}
      onClose={onClose}
      tr={tr}
      footer={
        <button className="dash-btn" onClick={onClose}>
          {tr("common.close")}
        </button>
      }
    >
      <p className="dash-confirm-vehicle">
        {booking.bookingNumber} · {booking.customerName}
        {booking.publicCode && <code className="dash-code"> {booking.publicCode}</code>}
      </p>
      {loading && <p className="dash-form-note">{tr("decision.decisionLoading")}</p>}
      {error && <div className="dash-form-error">{error}</div>}

      {info && !kind && <p className="dash-form-note">{tr("decision.messageNone")}</p>}

      {info && message && (
        <>
          <div className="dash-msg-actions">
            {wa ? (
              <a className="dash-btn dash-btn--primary" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => log("whatsapp")}>
                <MessageCircle size={16} /> {tr("decision.messageWhatsApp")}
              </a>
            ) : (
              <span className="dash-badge dash-badge--muted">{tr("decision.messageNoPhone")}</span>
            )}
            {mail ? (
              <a className="dash-btn" href={mail} onClick={() => log("mailto")}>
                <Mail size={16} /> {tr("decision.messageEmail")}
              </a>
            ) : (
              <span className="dash-badge dash-badge--muted">{tr("decision.emailNoAddress")}</span>
            )}
          </div>
          <Preview text={message.text} lang={message.lang} tr={tr} />
        </>
      )}

      {info && info.notifications.length > 0 && (
        <div className="dash-msg-log">
          <h3>{tr("decision.messageLog")}</h3>
          <ul>
            {info.notifications.map((n, i) => (
              <li key={i}>
                <span>{fmtWhen(n.createdAt, locale)}</span> · {tr(`decision.kind_${n.kind}`)} · {tr(`decision.channel_${n.channel}`)} ·{" "}
                <strong className={n.result === "failed" ? "is-bad" : "is-ok"}>{tr(`decision.result_${n.result}`)}</strong>
                {n.error && <span className="dash-form-note"> ({n.error})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {info && info.history.length > 0 && (
        <div className="dash-msg-log">
          <h3>{tr("decision.historyTitle")}</h3>
          <ul>
            {info.history.map((h, i) => (
              <li key={i}>
                <span>{fmtWhen(h.at, locale)}</span> · {tr(`decision.action_${h.action.replace(/^booking\./, "")}`)}
                {h.by && (
                  <>
                    {" "}
                    · {tr("decision.historyBy")} {h.by}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Shell>
  );
}
