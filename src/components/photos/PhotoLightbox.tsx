"use client";

// Απλό lightbox: μία φωτογραφία σε όλη την οθόνη, «Προηγούμενη/Επόμενη»,
// πλήκτρα ← → Esc, swipe σε κινητό, κλείσιμο με πάτημα στο φόντο.
// Ανοίγει μόνο μετά από πάτημα (client), οπότε το document υπάρχει.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";

export default function PhotoLightbox({
  urls,
  index,
  onIndex,
  onClose,
  alt,
}: {
  urls: string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  alt: string;
}) {
  const tr = useT();
  const touchX = useRef<number | null>(null);
  const count = urls.length;
  const go = (d: number) => count > 1 && onIndex((index + d + count) % count);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (count === 0) return null;
  const url = urls[Math.min(index, count - 1)];

  // Portal στο body: έξω από modals με transform/overflow.
  return createPortal(
    <div
      className="dash-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start === null) return;
        const dx = e.changedTouches[0].clientX - start;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <button type="button" className="dash-lightbox-close" onClick={onClose} aria-label={tr("common.close")}>
        <X size={22} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} onClick={(e) => e.stopPropagation()} />
      {count > 1 && (
        <>
          <button
            type="button"
            className="dash-lightbox-nav dash-lightbox-prev"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label={tr("photos.previous")}
          >
            <ChevronLeft size={26} />
          </button>
          <button
            type="button"
            className="dash-lightbox-nav dash-lightbox-next"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label={tr("photos.next")}
          >
            <ChevronRight size={26} />
          </button>
          <span className="dash-lightbox-count">
            {index + 1} / {count}
          </span>
        </>
      )}
    </div>,
    document.body
  );
}
