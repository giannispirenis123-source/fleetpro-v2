"use client";
// src/app/global-error.tsx — σφάλμα στο ίδιο το root layout. Δικό του <html>/<body>
// (αντικαθιστά τον layout). Ίδια οθόνη με τα error.tsx: κανένα τεχνικό μήνυμα.

import ErrorScreen from "@/components/errors/ErrorScreen";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="el">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <ErrorScreen lang="both" digest={error.digest} onRetry={reset} back={{ href: "/", label: "Αρχή / Home" }} />
      </body>
    </html>
  );
}
