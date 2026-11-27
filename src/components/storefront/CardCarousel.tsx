"use client";
// src/components/storefront/CardCarousel.tsx
// Καρουζέλ φωτογραφιών της κάρτας κατηγορίας (GroupCard).
//
// · Κινητό: swipe με scroll-snap + τελίτσες. Υπολογιστής: και βελάκια.
// · Αυτόματη εναλλαγή κάθε 4΄΄ ΜΟΝΟ όταν η κάρτα φαίνεται στην οθόνη και η
//   καρτέλα του browser είναι ενεργή. Με prefers-reduced-motion: καμία
//   αυτόματη εναλλαγή. Σταματά σε hover/εστίαση (συνεχίζει μετά) και οριστικά
//   μόλις ο χρήστης αγγίξει ή πατήσει βελάκι/τελίτσα.
// · Lazy: αρχικά φορτώνεται ΜΟΝΟ η πρώτη φωτογραφία· κάθε επόμενη μόλις
//   πλησιάσει (η τρέχουσα + η επόμενη), με cloudinaryThumb.
// · Μία φωτογραφία → απλή εικόνα, χωρίς βελάκια/τελίτσες.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fill, type StorefrontDictionary } from "@/lib/storefront/i18n";
import { cloudinaryThumb } from "@/lib/vehiclePhotos";

export const CAROUSEL_INTERVAL_MS = 4000;

const SIZES = "(min-width: 1080px) 340px, (min-width: 700px) 45vw, 100vw";

function Photo({ url, alt, eager }: { url: string; alt: string; eager: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cloudinaryThumb(url, 640)}
      srcSet={`${cloudinaryThumb(url, 400)} 400w, ${cloudinaryThumb(url, 640)} 640w, ${cloudinaryThumb(url, 960)} 960w`}
      sizes={SIZES}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
    />
  );
}

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export default function CardCarousel({
  photos,
  alt,
  eager,
  d,
}: {
  photos: string[];
  alt: string;
  /** Η κάρτα είναι από τις πρώτες: η ΠΡΩΤΗ φωτογραφία φορτώνει αμέσως. */
  eager?: boolean;
  d: StorefrontDictionary;
}) {
  const n = photos.length;
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // Ποιες φωτογραφίες έχουν «ζητηθεί» (αρχικά μόνο η πρώτη).
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set([0]));
  const want = useCallback((...idx: number[]) => {
    setLoaded((prev) => (idx.every((i) => prev.has(i)) ? prev : new Set([...prev, ...idx])));
  }, []);
  const [hovered, setHovered] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [visible, setVisible] = useState(false);

  // Η τρέχουσα + η επόμενη φορτώνουν — ΜΟΝΟ αφού η κάρτα φανεί ή ο χρήστης
  // κινήσει το καρουζέλ· ως τότε μόνο η πρώτη. Οι υπόλοιπες όταν χρειαστούν.
  useEffect(() => {
    if (n > 1 && (visible || index > 0)) want(index, (index + 1) % n);
  }, [index, n, visible, want]);

  // Αυτόματη εναλλαγή μόνο όσο η κάρτα φαίνεται (και δεν φορτώνει τίποτα εκτός οθόνης).
  useEffect(() => {
    if (n < 2 || !rootRef.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && e.intersectionRatio >= 0.5), {
      threshold: [0, 0.5, 1],
    });
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, [n]);

  const goTo = useCallback(
    (i: number, smooth = true) => {
      const track = trackRef.current;
      if (!track || n < 2) return;
      const next = ((i % n) + n) % n;
      want(next);
      track.scrollTo({ left: next * track.clientWidth, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
    },
    [n, want]
  );

  useEffect(() => {
    if (n < 2 || stopped || hovered || !visible || prefersReducedMotion()) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      goTo(index + 1);
    }, CAROUSEL_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [n, stopped, hovered, visible, index, goTo]);

  // Η θέση από το scroll (swipe, βελάκια, αυτόματη εναλλαγή).
  const onScroll = () => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i !== index && i >= 0 && i < n) setIndex(i);
  };

  if (n === 1) return <Photo url={photos[0]} alt={alt} eager={!!eager} />;

  const userGo = (i: number) => {
    setStopped(true);
    goTo(i);
  };

  return (
    <div
      ref={rootRef}
      className="sf-car"
      role="group"
      aria-roledescription="carousel"
      aria-label={alt}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onTouchStart={() => setStopped(true)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div ref={trackRef} className="sf-car-track" onScroll={onScroll}>
        {photos.map((url, i) => (
          <div
            key={url}
            className="sf-car-slide"
            role="group"
            aria-roledescription="slide"
            aria-label={fill(d.photoOf, { n: i + 1, total: n })}
            aria-hidden={i !== index}
          >
            {loaded.has(i) ? <Photo url={url} alt={i === 0 ? alt : ""} eager={i === 0 && !!eager} /> : null}
          </div>
        ))}
      </div>

      <button type="button" className="sf-car-arrow sf-car-arrow--prev" aria-label={d.prevPhoto} onClick={() => userGo(index - 1)}>
        <ChevronLeft size={20} aria-hidden />
      </button>
      <button type="button" className="sf-car-arrow sf-car-arrow--next" aria-label={d.nextPhoto} onClick={() => userGo(index + 1)}>
        <ChevronRight size={20} aria-hidden />
      </button>

      <div className="sf-car-dots">
        {photos.map((url, i) => (
          <button
            key={url}
            type="button"
            className="sf-car-dot"
            aria-label={fill(d.photoOf, { n: i + 1, total: n })}
            aria-current={i === index ? "true" : undefined}
            onClick={() => userGo(i)}
          />
        ))}
      </div>
    </div>
  );
}
