// Δημόσιο site /s/<slug>/… — ΜΟΝΟ metadata, χωρίς markup.
// Αντικαθιστά τα metadata της πλατφόρμας (root layout: «FleetPro — …», keywords)
// ώστε καμία σελίδα του site — ούτε το 404 (άγνωστο slug, ανενεργή σελίδα) —
// να μη δείχνει προς το FleetPro ή να φανερώνει στοιχεία εταιρίας. Κάθε
// σελίδα ορίζει τα δικά της (src/lib/storefront/seo.ts).
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404",
  description: null,
  keywords: null,
  robots: { index: false, follow: false },
};

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return children;
}
