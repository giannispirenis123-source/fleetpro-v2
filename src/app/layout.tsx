// src/app/layout.tsx

import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import { SITE_LANG_HEADER, htmlLang } from "@/lib/storefront/lang";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "greek"] });

export const metadata: Metadata = {
  title: "FleetPro — Διαχείριση Στόλου Οχημάτων",
  description:
    "Η πλατφόρμα SaaS για εταιρίες ενοικίασης οχημάτων. Κρατήσεις, συμβόλαια, τιμολόγια και στατιστικά σε ένα μέρος.",
  keywords: "rent a car, διαχείριση στόλου, κρατήσεις, συμβόλαια",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Δημόσιο site: η γλώσσα της σελίδας (από το middleware)· αλλιώς ελληνικά.
  const lang = htmlLang(headers().get(SITE_LANG_HEADER));
  return (
    <html lang={lang}>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
