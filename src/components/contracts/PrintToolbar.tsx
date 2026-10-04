"use client";
// Γραμμή εργαλείων της σελίδας εκτύπωσης — δεν τυπώνεται.
//
// Οι φωτογραφίες ζημιών φορτώνονται από προσωρινά URLs: πριν ανοίξει το
// παράθυρο εκτύπωσης περιμένουμε να φορτώσουν (ή να αποτύχουν), με όριο
// χρόνου, ώστε να μη βγει χαρτί με κενά κουτάκια.

import { useState } from "react";
import { Printer, ArrowLeft } from "lucide-react";

const WAIT_MS = 15_000;

function imagesReady(): Promise<void> {
  const pending = Array.from(document.querySelectorAll<HTMLImageElement>(".cdoc img")).filter(
    (img) => !img.complete
  );
  if (pending.length === 0) return Promise.resolve();
  const all = Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        })
    )
  ).then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, WAIT_MS));
  return Promise.race([all, timeout]);
}

export default function PrintToolbar({ backHref }: { backHref: string }) {
  const [waiting, setWaiting] = useState(false);

  const print = async () => {
    setWaiting(true);
    try {
      await imagesReady();
    } finally {
      setWaiting(false);
    }
    window.print();
  };

  return (
    <div className="cdoc-toolbar">
      <a href={backHref} className="cdoc-toolbar-btn">
        <ArrowLeft size={16} /> Πίσω / Back
      </a>
      <button
        type="button"
        className="cdoc-toolbar-btn cdoc-toolbar-btn--primary"
        onClick={print}
        disabled={waiting}
      >
        <Printer size={16} />{" "}
        {waiting ? "Φόρτωση φωτογραφιών… / Loading photos…" : "Εκτύπωση / Print"}
      </button>
    </div>
  );
}
