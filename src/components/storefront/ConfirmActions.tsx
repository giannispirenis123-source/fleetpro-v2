"use client";
// src/components/storefront/ConfirmActions.tsx
// Μικρά κουμπιά της σελίδας επιβεβαίωσης: αντιγραφή κωδικού και εκτύπωση.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function CopyCode({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* χωρίς πρόσβαση στο clipboard: ο κωδικός φαίνεται και επιλέγεται με το χέρι */
    }
  };
  return (
    <span className="sf-confirm-codeline">
      <code className="sf-confirm-codevalue">{code}</code>
      <button type="button" className="sf-btn sf-btn--ghost sf-btn--sm" onClick={copy} aria-live="polite">
        {copied ? copiedLabel : copyLabel}
      </button>
    </span>
  );
}

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="sf-btn sf-btn--ghost sf-confirm-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}

/**
 * Όσο η κράτηση περιμένει πληρωμή η σελίδα ξαναφορτώνεται (3΄΄ μετά το ?paid=1,
 * αλλιώς 10΄΄). Σε κάθε φόρτωση ο server ρωτά το Stripe (όριο 1/10΄΄) με την
 * ΙΔΙΑ μετάβαση με το webhook — εδώ απλώς ανανεώνεται η εικόνα.
 */
export function PaymentPoll({ everyMs = 3000, maxTimes = 15 }: { everyMs?: number; maxTimes?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (n > maxTimes) clearInterval(id);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs, maxTimes]);
  return null;
}
