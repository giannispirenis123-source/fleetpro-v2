"use client";
// src/app/error.tsx — σφάλμα σε σελίδα χωρίς δικό της error.tsx (login, /pay κ.λπ.).
// Το σφάλμα του server γράφεται ήδη στα logs του Vercel από το Next, με τον ίδιο
// κωδικό digest που βλέπει εδώ ο χρήστης· στην οθόνη ΠΟΤΕ μήνυμα ή stack.

import ErrorScreen from "@/components/errors/ErrorScreen";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen lang="both" digest={error.digest} onRetry={reset} back={{ href: "/", label: "Αρχή / Home" }} />;
}
