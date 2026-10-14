// src/app/not-found.tsx
// Φιλικό 404 της εφαρμογής (αντί για το «This page could not be found» του Next).
// Ίδιο για όλους: δεν λέει τίποτα για εταιρίες ή δημόσιες σελίδες.

import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#fff", color: "#0f172a" }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <p style={{ fontSize: 44, fontWeight: 800, margin: 0 }}>404</p>
        <h1 style={{ fontSize: 20, margin: "8px 0" }}>Η σελίδα δεν βρέθηκε</h1>
        <p style={{ color: "#475569", margin: "0 0 20px" }}>Page not found</p>
        <Link href="/" style={{ color: "#4f46e5", fontWeight: 600 }}>
          ← Αρχή / Home
        </Link>
      </div>
    </main>
  );
}
