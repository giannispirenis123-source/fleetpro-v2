"use client";
// src/components/errors/ErrorScreen.tsx
// Η οθόνη σφάλματος (error.tsx / global-error.tsx) — ίδια σε όλη την εφαρμογή.
//
// ΑΣΦΑΛΕΙΑ: ΠΟΤΕ το μήνυμα ή το stack του σφάλματος (μπορεί να έχει στοιχεία
// πελάτη ή τεχνικές λεπτομέρειες). Φαίνεται μόνο ο κωδικός `digest` του Next,
// που ταιριάζει με την εγγραφή στα logs του server (Vercel → Logs) για αναφορά.
// Χωρίς εξαρτήσεις από CSS/πάροχο γλώσσας: δουλεύει και όταν έσπασε ο ίδιος ο layout.

import { safeDigest } from "./digest";

export type ErrorLang = "el" | "en" | "both";

const TEXT = {
  el: {
    title: "Κάτι πήγε στραβά",
    text: "Δεν ήταν δυνατό να φορτωθεί η σελίδα. Δοκιμάστε ξανά σε λίγο.",
    retry: "Δοκιμάστε ξανά",
    code: "Κωδικός σφάλματος",
  },
  en: {
    title: "Something went wrong",
    text: "The page could not be loaded. Please try again in a moment.",
    retry: "Try again",
    code: "Error code",
  },
} as const;


export default function ErrorScreen({
  lang,
  digest,
  onRetry,
  back,
  fullPage = true,
}: {
  lang: ErrorLang;
  digest?: string;
  onRetry: () => void;
  /** Σύνδεσμος επιστροφής (π.χ. αρχική του site / dashboard). */
  back: { href: string; label: string };
  fullPage?: boolean;
}) {
  const code = safeDigest(digest);
  const t = lang === "en" ? TEXT.en : TEXT.el;
  const both = lang === "both";
  return (
    <main
      role="alert"
      style={{
        minHeight: fullPage ? "100vh" : "50vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: fullPage ? "#fff" : "transparent",
        color: "#0f172a",
        fontFamily: "inherit",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 440 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>{t.title}</h1>
        {both && <p style={{ color: "#475569", margin: "0 0 8px", fontWeight: 600 }}>{TEXT.en.title}</p>}
        <p style={{ color: "#475569", margin: "0 0 4px" }}>{t.text}</p>
        {both && <p style={{ color: "#475569", margin: 0 }}>{TEXT.en.text}</p>}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 20 }}>
          <button
            type="button"
            onClick={onRetry}
            style={{
              minHeight: 44,
              padding: "10px 18px",
              borderRadius: 10,
              border: 0,
              background: "#4f46e5",
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            {both ? `${TEXT.el.retry} / ${TEXT.en.retry}` : t.retry}
          </button>
          {/* Πλήρης φόρτωση (όχι client navigation): καθαρή αρχή μετά από σφάλμα. */}
          <a
            href={back.href}
            style={{ minHeight: 44, display: "inline-flex", alignItems: "center", padding: "10px 4px", color: "#4f46e5", fontWeight: 600 }}
          >
            ← {back.label}
          </a>
        </div>
        {code && (
          <p style={{ color: "#64748b", fontSize: 12.5, marginTop: 20 }}>
            {both ? `${TEXT.el.code} / ${TEXT.en.code}` : t.code}: <code>{code}</code>
          </p>
        )}
      </div>
    </main>
  );
}
