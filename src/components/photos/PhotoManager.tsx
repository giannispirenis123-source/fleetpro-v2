"use client";

// Φωτογραφίες με κάμερα ή από τη συλλογή — ΚΟΙΝΟ για συμβόλαια και ζημιές.
//
// · «Κάμερα»: input capture="environment" → ανοίγει την πίσω κάμερα σε
//   κινητό/tablet (σε υπολογιστή ανοίγει απλή επιλογή αρχείου).
// · «Συλλογή»: πολλαπλή επιλογή αρχείων.
// · Κάθε φωτογραφία συμπιέζεται ΣΤΟΝ BROWSER (~1600px, JPEG 0.8) και
//   ανεβαίνει μία-μία με ένδειξη προόδου. Αποτυχία = καθαρό μήνυμα και
//   «Ξανά»· η φόρμα γύρω της δεν επηρεάζεται.

import { useRef, useState } from "react";
import { ImagePlus, RotateCcw, Trash2, X, ImageOff } from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import { compressImage } from "@/lib/imageCompress";
import { PHOTO_NOTE_MAX, type PhotoItem } from "@/lib/photoShared";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };

const stamp = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL[locale] ?? "el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Athens",
  }).format(new Date(iso));

interface QueueItem {
  key: string;
  file: File;
  status: "waiting" | "compressing" | "uploading" | "error";
  progress: number;
  message: string;
}

/** Ανέβασμα με XHR για να έχουμε πρόοδο (το fetch δεν δίνει upload progress). */
function send(
  url: string,
  form: FormData,
  onProgress: (p: number) => void
): Promise<{ status: number; body: { message?: string; data?: { photo: PhotoItem } } }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* κενό ή μη JSON */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(form);
  });
}

export default function PhotoManager({
  photos,
  uploadUrl,
  fields,
  itemUrl,
  editable,
  withNotes,
  max,
  lockedText,
  counter,
  onAdded,
  onRemoved,
  onNoted,
}: {
  photos: PhotoItem[];
  /** POST multipart εδώ (πεδίο file + `fields`). */
  uploadUrl: string;
  fields?: Record<string, string>;
  /** PATCH { note } / DELETE για μία φωτογραφία. */
  itemUrl: (id: string) => string;
  /** Προσθήκη, διαγραφή και σημείωση. */
  editable: boolean;
  withNotes: boolean;
  /** Πόσες ακόμα χωράνε (όριο συμβολαίου/ζημιάς). */
  max: number;
  /** Γιατί δεν αλλάζουν — εμφανίζεται όταν !editable. */
  lockedText?: string;
  /** Το κείμενο του μετρητή (π.χ. σύνολο συμβολαίου «3/40»)· αλλιώς «n/max». */
  counter?: string;
  onAdded: (photo: PhotoItem) => void;
  onRemoved: (id: string) => void;
  onNoted: (id: string, note: string) => void;
}) {
  const tr = useT();
  const locale = useLocale();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const running = useRef(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const update = (fn: (q: QueueItem[]) => QueueItem[]) => {
    queueRef.current = fn(queueRef.current);
    setQueue(queueRef.current);
  };
  const patch = (key: string, p: Partial<QueueItem>) =>
    update((q) => q.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const pending = queue.filter((i) => i.status !== "error").length;
  const room = Math.max(0, max - photos.length - pending);

  const process = async (item: QueueItem) => {
    patch(item.key, { status: "compressing", progress: 0, message: "" });
    let blob: Blob;
    try {
      blob = await compressImage(item.file);
    } catch {
      patch(item.key, { status: "error", message: tr("photos.errorRead") });
      return;
    }
    patch(item.key, { status: "uploading" });
    const form = new FormData();
    form.append("file", blob, "photo.jpg");
    form.append("takenAt", new Date(item.file.lastModified || Date.now()).toISOString());
    for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v);
    try {
      const res = await send(uploadUrl, form, (p) => patch(item.key, { progress: p }));
      if (res.status >= 200 && res.status < 300 && res.body.data?.photo) {
        update((q) => q.filter((i) => i.key !== item.key));
        onAdded(res.body.data.photo);
      } else {
        patch(item.key, {
          status: "error",
          message: res.body.message || tr("photos.errorUpload"),
        });
      }
    } catch {
      patch(item.key, { status: "error", message: tr("photos.errorConnection") });
    }
  };

  /** Ένα-ένα, με τη σειρά. */
  const pump = async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = queueRef.current.find((i) => i.status === "waiting");
        if (!next) break;
        await process(next);
      }
    } finally {
      running.current = false;
    }
  };

  const pick = (list: FileList | null) => {
    setError("");
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || f.type === "");
    if (files.length === 0) return;
    const allowed = files.slice(0, room);
    if (allowed.length < files.length) setError(tr("photos.limitReached"));
    update((q) => [
      ...q,
      ...allowed.map((file) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        status: "waiting" as const,
        progress: 0,
        message: "",
      })),
    ]);
    void pump();
  };

  const retry = (key: string) => {
    patch(key, { status: "waiting", message: "", progress: 0 });
    void pump();
  };

  const remove = async (id: string) => {
    if (!window.confirm(tr("photos.confirmDelete"))) return;
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(itemUrl(id), { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message || tr("photos.errorDelete"));
        return;
      }
      onRemoved(id);
    } catch {
      setError(tr("photos.errorConnection"));
    } finally {
      setBusyId(null);
    }
  };

  const saveNote = async (p: PhotoItem) => {
    const note = (notes[p.id] ?? p.note).trim();
    if (note === p.note) return;
    setError("");
    try {
      const res = await fetch(itemUrl(p.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message || tr("photos.errorSave"));
        return;
      }
      onNoted(p.id, note);
    } catch {
      setError(tr("photos.errorConnection"));
    }
  };

  return (
    <div className="dash-photos">
      {editable && (
        <div className="dash-photos-actions">
          <button
            type="button"
            className="dash-btn dash-btn--primary"
            disabled={room === 0}
            onClick={() => cameraRef.current?.click()}
          >
            {tr("photos.camera")}
          </button>
          <button
            type="button"
            className="dash-btn"
            disabled={room === 0}
            onClick={() => galleryRef.current?.click()}
          >
            <ImagePlus size={16} /> {tr("photos.gallery")}
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            multiple
            hidden
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="dash-form-note">{counter ?? `${photos.length}/${max}`}</span>
        </div>
      )}
      {!editable && lockedText && <p className="dash-form-note">{lockedText}</p>}

      {queue.length > 0 && (
        <ul className="dash-photo-queue">
          {queue.map((i) => (
            <li key={i.key} className={i.status === "error" ? "error" : ""}>
              <span className="dash-photo-queue-name">{i.file.name || tr("photos.photo")}</span>
              {i.status === "error" ? (
                <>
                  <span className="dash-photo-queue-msg">{i.message}</span>
                  <button type="button" className="dash-btn" onClick={() => retry(i.key)}>
                    <RotateCcw size={14} /> {tr("photos.retry")}
                  </button>
                  <button
                    type="button"
                    className="dash-icon-btn"
                    aria-label={tr("photos.dismiss")}
                    onClick={() => update((q) => q.filter((x) => x.key !== i.key))}
                  >
                    <X size={15} />
                  </button>
                </>
              ) : (
                <>
                  <span className="dash-photo-queue-msg">
                    {i.status === "compressing"
                      ? tr("photos.compressing")
                      : i.status === "uploading"
                        ? `${tr("photos.uploading")} ${Math.round(i.progress * 100)}%`
                        : tr("photos.waiting")}
                  </span>
                  <span className="dash-photo-bar">
                    <span style={{ width: `${Math.round(i.progress * 100)}%` }} />
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <div className="dash-form-error">{error}</div>}

      {photos.length === 0 && queue.length === 0 ? (
        <p className="dash-form-note">{tr("photos.none")}</p>
      ) : (
        <div className="dash-photo-grid">
          {photos.map((p) => (
            <figure key={p.id} className="dash-photo">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.note || tr("photos.photo")} loading="lazy" />
                </a>
              ) : (
                <span className="dash-photo-missing">
                  <ImageOff size={18} /> {tr("photos.unavailable")}
                </span>
              )}
              <figcaption>
                {p.takenAt && <span className="dash-photo-time">{stamp(p.takenAt, locale)}</span>}
                {withNotes &&
                  (editable ? (
                    <input
                      value={notes[p.id] ?? p.note}
                      maxLength={PHOTO_NOTE_MAX}
                      placeholder={tr("photos.notePlaceholder")}
                      onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                      onBlur={() => saveNote(p)}
                    />
                  ) : (
                    p.note && <span className="dash-photo-note">{p.note}</span>
                  ))}
                {editable && (
                  <button
                    type="button"
                    className="dash-icon-btn dash-icon-btn--danger"
                    disabled={busyId === p.id}
                    onClick={() => remove(p.id)}
                    aria-label={tr("photos.delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
