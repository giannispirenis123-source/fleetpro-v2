"use client";
// src/components/storefront/Carousel.tsx
// Ελαφρύ carousel χωρίς βιβλιοθήκη: CSS scroll-snap (swipe στο κινητό),
// βελάκια στο desktop, ← / → από το πληκτρολόγιο, aria για αναγνώστες οθόνης.
// Τα στοιχεία είναι απλές κάρτες (links/κείμενο) — δουλεύουν και χωρίς JS.

import { Children, useCallback, useEffect, useRef, useState } from "react";

export default function Carousel({
  label,
  prevLabel,
  nextLabel,
  slideLabel,
  className = "",
  children,
}: {
  /** Όνομα της ενότητας (aria-label). */
  label: string;
  prevLabel: string;
  nextLabel: string;
  /** «{n} από {total}» — για κάθε κάρτα (template: οι server components δεν περνούν συναρτήσεις). */
  slideLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const items = Children.toArray(children);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector("li");
    const width = card ? (card as HTMLElement).offsetWidth + 16 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * width, behavior: "smooth" });
  };

  return (
    <div className={`sf-carousel ${className}`} role="region" aria-roledescription="carousel" aria-label={label}>
      <button type="button" className="sf-carousel-btn is-prev" onClick={() => step(-1)} disabled={edge.start} aria-label={prevLabel}>
        ‹
      </button>
      <ul
        ref={track}
        className="sf-carousel-track"
        tabIndex={0}
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            step(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            step(-1);
          }
        }}
      >
        {items.map((child, i) => (
          <li key={i} className="sf-carousel-item" aria-roledescription="slide" aria-label={slideLabel.replace("{n}", String(i + 1)).replace("{total}", String(items.length))}>
            {child}
          </li>
        ))}
      </ul>
      <button type="button" className="sf-carousel-btn is-next" onClick={() => step(1)} disabled={edge.end} aria-label={nextLabel}>
        ›
      </button>
    </div>
  );
}
