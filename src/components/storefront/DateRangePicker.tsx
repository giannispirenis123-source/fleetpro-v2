"use client";
// src/components/storefront/DateRangePicker.tsx
// Επιλογή εύρους ημερομηνιών σε ΜΙΑ οθόνη (στο κινητό: όλη η οθόνη, μήνες
// με κύλιση). Χωρίς βιβλιοθήκη: ημερομηνίες ως κείμενο "YYYY-MM-DD" (UTC
// αριθμητική) → καμία εξάρτηση από τη ζώνη ώρας του browser.
//
// Πληκτρολόγιο: Tab στις ημέρες, βέλη ±1 / ±7 ημέρες, Enter/Space επιλογή,
// Esc κλείσιμο (η εστίαση γυρνά στο κουμπί που το άνοιξε).

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDay, type StorefrontDictionary } from "@/lib/storefront/i18n";
import { addDays } from "@/lib/public/search";

type Labels = Pick<
  StorefrontDictionary,
  | "pickupDate"
  | "dropoffDate"
  | "choosePickupDay"
  | "chooseDropoffDay"
  | "done"
  | "close"
  | "weekdaysShort"
  | "monthsShort"
  | "months"
  | "chooseDates"
>;

interface Props {
  start: string;
  end: string;
  /** Πρώτη επιτρεπτή ημέρα (σήμερα, ώρα Ελλάδας). */
  minDate: string;
  maxDate: string;
  d: Labels;
  onChange: (start: string, end: string) => void;
  /** Για να ανοίγει από έξω (π.χ. «Δείτε τιμές» μιας κάρτας). */
  openSignal?: number;
  invalid?: { start?: boolean; end?: boolean };
  idPrefix: string;
}

interface Month {
  y: number;
  m: number; // 0–11
  key: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, day: number) => `${y}-${pad(m + 1)}-${pad(day)}`;

function monthsBetween(minDate: string, maxDate: string): Month[] {
  const out: Month[] = [];
  let y = Number(minDate.slice(0, 4));
  let m = Number(minDate.slice(5, 7)) - 1;
  const endKey = maxDate.slice(0, 7);
  for (let i = 0; i < 25; i++) {
    const key = `${y}-${pad(m + 1)}`;
    out.push({ y, m, key });
    if (key >= endKey) break;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export default function DateRangePicker({ start, end, minDate, maxDate, d, onChange, openSignal, invalid, idPrefix }: Props) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState<string | null>(end);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const months = useMemo(() => monthsBetween(minDate, maxDate), [minDate, maxDate]);

  const openPicker = () => {
    setDraftStart(start);
    setDraftEnd(end);
    setOpen(true);
  };

  useEffect(() => {
    if (openSignal) openPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  // Εστίαση στην επιλεγμένη ημέρα όταν ανοίγει· κύλιση στον μήνα της.
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current?.querySelector<HTMLButtonElement>(`[data-date="${draftStart}"]`)
      ?? dialogRef.current?.querySelector<HTMLButtonElement>("button[data-date]:not([disabled])");
    // Κύλιση ΜΟΝΟ της λίστας μηνών (όχι της σελίδας/του παραθύρου).
    const list = dialogRef.current?.querySelector<HTMLElement>(".sf-cal-months");
    if (el && list) list.scrollTop = Math.max(0, el.offsetTop - 80);
    el?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const confirm = () => {
    const s = draftStart;
    const e = draftEnd && draftEnd > s ? draftEnd : addDays(s, Math.max(1, (Date.parse(end) - Date.parse(start)) / 86_400_000 || 1));
    onChange(s, e);
    close();
  };

  const pick = (day: string) => {
    if (draftEnd === null && day > draftStart) {
      setDraftEnd(day);
    } else {
      setDraftStart(day);
      setDraftEnd(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const target = e.target as HTMLElement;
    const date = target.getAttribute?.("data-date");
    if (!date) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
    if (!step) return;
    e.preventDefault();
    const next = addDays(date, step);
    dialogRef.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]:not([disabled])`)?.focus();
  };

  // Η ημέρα που παίρνει την εστίαση με Tab (roving tabindex).
  const focusDay = draftStart >= minDate && draftStart <= maxDate ? draftStart : minDate;

  return (
    <div className="sf-dates">
      <button
        type="button"
        ref={triggerRef}
        className={`sf-field sf-field--btn${invalid?.start || invalid?.end ? " is-invalid" : ""}`}
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${d.chooseDates}: ${d.pickupDate} ${formatDay(start, d)}, ${d.dropoffDate} ${formatDay(end, d)}`}
        id={`${idPrefix}-dates`}
      >
        <span className="sf-dates-half">
          <span className="sf-label">{d.pickupDate}</span>
          <span className="sf-value">{formatDay(start, d)}</span>
        </span>
        <span className="sf-dates-arrow" aria-hidden>→</span>
        <span className="sf-dates-half">
          <span className="sf-label">{d.dropoffDate}</span>
          <span className="sf-value">{formatDay(end, d)}</span>
        </span>
      </button>

      {open && (
        <div className="sf-cal-backdrop" onClick={close}>
          <div
            className="sf-cal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${idPrefix}-cal-title`}
            ref={dialogRef}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onKeyDown}
          >
            <div className="sf-cal-head">
              <strong id={`${idPrefix}-cal-title`}>{draftEnd === null ? d.chooseDropoffDay : d.choosePickupDay}</strong>
              <button type="button" className="sf-cal-x" onClick={close} aria-label={d.close}>
                ×
              </button>
            </div>
            <div className="sf-cal-week" aria-hidden>
              {d.weekdaysShort.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="sf-cal-months">
              {months.map((mo) => {
                const first = new Date(Date.UTC(mo.y, mo.m, 1)).getUTCDay();
                const offset = (first + 6) % 7;
                const count = new Date(Date.UTC(mo.y, mo.m + 1, 0)).getUTCDate();
                return (
                  <section key={mo.key} className="sf-cal-month" aria-label={`${d.months[mo.m]} ${mo.y}`}>
                    <h3>
                      {d.months[mo.m]} {mo.y}
                    </h3>
                    <div className="sf-cal-grid" role="group">
                      {Array.from({ length: offset }, (_, i) => (
                        <span key={`e${i}`} />
                      ))}
                      {Array.from({ length: count }, (_, i) => {
                        const day = iso(mo.y, mo.m, i + 1);
                        const disabled = day < minDate || day > maxDate;
                        const isStart = day === draftStart;
                        const isEnd = day === draftEnd;
                        const inRange = draftEnd !== null && day > draftStart && day < draftEnd;
                        const cls = ["sf-day", isStart && "is-start", isEnd && "is-end", inRange && "is-range"].filter(Boolean).join(" ");
                        return (
                          <button
                            key={day}
                            type="button"
                            className={cls}
                            data-date={day}
                            disabled={disabled}
                            aria-pressed={isStart || isEnd}
                            aria-label={formatDay(day, d) + ` ${mo.y}`}
                            tabIndex={day === focusDay ? 0 : -1}
                            onClick={() => pick(day)}
                          >
                            {i + 1}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="sf-cal-foot">
              <span className="sf-cal-sum">
                {formatDay(draftStart, d)} → {draftEnd ? formatDay(draftEnd, d) : "…"}
              </span>
              <button type="button" className="sf-btn sf-btn--primary" onClick={confirm}>
                {d.done}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
