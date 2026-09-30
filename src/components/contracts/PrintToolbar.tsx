"use client";
// Γραμμή εργαλείων της σελίδας εκτύπωσης — δεν τυπώνεται.

import { Printer, ArrowLeft } from "lucide-react";

export default function PrintToolbar({ backHref }: { backHref: string }) {
  return (
    <div className="cdoc-toolbar">
      <a href={backHref} className="cdoc-toolbar-btn">
        <ArrowLeft size={16} /> Πίσω / Back
      </a>
      <button type="button" className="cdoc-toolbar-btn cdoc-toolbar-btn--primary" onClick={() => window.print()}>
        <Printer size={16} /> Εκτύπωση / Print
      </button>
    </div>
  );
}
