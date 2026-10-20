// src/app/pay/[result]/page.tsx
// Εδώ γυρίζει ο πελάτης από το Stripe μετά την πληρωμή του συμβολαίου (ή αν
// την ακύρωσε). Στατικό κείμενο, χωρίς κανένα στοιχείο εταιρίας, πελάτη ή
// πληρωμής: η επιβεβαίωση έρχεται ΜΟΝΟ από το webhook στο συμβόλαιο.

import { notFound } from "next/navigation";

export const dynamic = "force-static";
export const dynamicParams = false;
export const metadata = { title: "FleetPro", robots: { index: false, follow: false } };

const TEXT = {
  done: {
    title: "Ευχαριστούμε! / Thank you!",
    lines: [
      "Η πληρωμή στάλθηκε. Ο υπάλληλος θα τη δει επιβεβαιωμένη στο συμβόλαιο σε λίγα δευτερόλεπτα.",
      "Your payment was submitted. The staff will see it confirmed on the agreement in a few seconds.",
    ],
  },
  cancelled: {
    title: "Η πληρωμή δεν ολοκληρώθηκε / Payment not completed",
    lines: [
      "Δεν χρεώθηκε τίποτα. Μπορείτε να ξαναδοκιμάσετε από το ίδιο link ή QR.",
      "Nothing was charged. You can try again from the same link or QR code.",
    ],
  },
} as const;

export function generateStaticParams() {
  return [{ result: "done" }, { result: "cancelled" }];
}

export default function PayResultPage({ params }: { params: { result: string } }) {
  const t = TEXT[params.result as keyof typeof TEXT];
  if (!t) notFound();
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "#f8fafc", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 420, width: "100%", background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.08)", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 8 }} aria-hidden>{params.result === "done" ? "✓" : "↺"}</div>
        <h1 style={{ fontSize: 20, margin: "0 0 12px", color: "#0f172a" }}>{t.title}</h1>
        {t.lines.map((l) => (
          <p key={l} style={{ margin: "0 0 8px", color: "#475569", lineHeight: 1.5 }}>{l}</p>
        ))}
      </div>
    </main>
  );
}
