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
 * Μετά την επιστροφή από το Stripe (?paid=1): η σελίδα ξαναφορτώνεται κάθε
 * 3΄΄ (έως ~45΄΄) μέχρι το webhook να γράψει την πληρωμή. Το PAID έρχεται
 * ΜΟΝΟ από το webhook — εδώ απλώς ανανεώνεται η εικόνα.
 */
export function PaymentPoll() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (n > 15) clearInterval(id);
      else router.refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
