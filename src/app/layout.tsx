// src/app/layout.tsx

import type { Metadata } from "next";
import { Inter } from "next/font/google";
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
  return (
    <html lang="el">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
