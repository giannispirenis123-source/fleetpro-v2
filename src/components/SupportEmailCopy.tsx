"use client";

// src/components/SupportEmailCopy.tsx
// Η διεύθυνση υποστήριξης ως ΟΡΑΤΟ κείμενο (επιλέξιμο, mailto σύνδεσμος) +
// κουμπί «Αντιγραφή». Σε υπολογιστή χωρίς πρόγραμμα email το mailto δεν κάνει
// τίποτα — η διεύθυνση φαίνεται και αντιγράφεται.
//
// Αντιγραφή: navigator.clipboard· αν δεν υπάρχει ή αποτύχει (παλιός browser,
// http, άρνηση άδειας) → αθόρυβα επιλέγεται το κείμενο της διεύθυνσης, ώστε
// να γίνει Ctrl+C / «Αντιγραφή» από το μενού. Κανένα σφάλμα στον χρήστη.
// Τα κείμενα έρχονται από τον καλούντα (i18n του καθενός).

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export interface SupportEmailCopyProps {
  email: string;
  labels: { copy: string; copied: string };
  className?: string;
  testIdPrefix?: string;
}

/** Επιλέγει το κείμενο ενός στοιχείου (fallback όταν δεν γίνεται αντιγραφή). */
function selectText(el: HTMLElement | null): void {
  try {
    if (!el) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* αθόρυβα */
  }
}

export default function SupportEmailCopy({ email, labels, className = "", testIdPrefix = "support-email" }: SupportEmailCopyProps) {
  const addrRef = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(email);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      // Αθόρυβο fallback: η διεύθυνση επιλέγεται για χειροκίνητη αντιγραφή.
      selectText(addrRef.current);
    }
  };

  return (
    <span className={`support-email ${className}`.trim()}>
      <a ref={addrRef} className="support-email-addr" href={`mailto:${email}`} data-testid={`${testIdPrefix}-addr`}>
        {email}
      </a>
      <button type="button" className="support-email-copy" onClick={copy} aria-label={`${labels.copy}: ${email}`} data-testid={`${testIdPrefix}-copy`}>
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        <span>{copied ? labels.copied : labels.copy}</span>
      </button>
      <span className="support-email-status" role="status" aria-live="polite">
        {copied ? labels.copied : ""}
      </span>
    </span>
  );
}

/** Κοινά στυλ — μπαίνουν από τον καλούντα στο δικό του <style>. Χρώματα από τις μεταβλητές της σελίδας. */
export const SUPPORT_EMAIL_STYLES = `
  .support-email { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; max-width: 100%; }
  .support-email-addr { font-weight: 600; user-select: all; -webkit-user-select: all; overflow-wrap: anywhere; }
  .support-email-copy {
    display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px;
    border: 1px solid var(--border, #cbd5e1); background: transparent; color: inherit;
    font: inherit; font-size: 11px; line-height: 1.4; cursor: pointer; white-space: nowrap;
  }
  .support-email-copy:hover { background: var(--surface-2, rgba(148,163,184,.15)); }
  .support-email-copy:focus-visible { outline: 2px solid var(--primary, #6366f1); outline-offset: 2px; }
  .support-email-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;
