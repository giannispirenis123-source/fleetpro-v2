// src/lib/storefront/paymentText.ts
// Το κείμενο της online πληρωμής ανά κατάσταση — ΕΝΑ σημείο για τη σελίδα του
// πελάτη (και τα tests). Καθαρό. Σε online κράτηση ΠΟΤΕ «Πληρωμή κατά την παραλαβή».

import type { ConfirmationPayment } from "../public/bookingRequest";
import { formatCents } from "../public/money";
import { fill, type StorefrontDictionary } from "./i18n";

export type PaymentTone = "wait" | "ok" | "info" | "bad";

export function paymentHeadline(p: ConfirmationPayment, d: StorefrontDictionary, lang: string): { tone: PaymentTone; text: string } {
  const euro = (c: number) => formatCents(c, lang);
  if (p.badge === "AWAITING") return { tone: "wait", text: d.payStatusAwaiting };
  if (p.refundedCents > 0 || p.retainedCents > 0) {
    const parts: string[] = [];
    if (p.refundedCents > 0) {
      parts.push(
        p.retainedCents > 0 || p.refundedCents >= p.amountCents
          ? fill(d.payRefunded, { amount: euro(p.refundedCents) })
          : fill(d.payPartRefunded, { amount: euro(p.refundedCents), total: euro(p.amountCents) })
      );
    }
    if (p.retainedCents > 0) parts.push(fill(d.payRetained, { amount: euro(p.retainedCents) }));
    return { tone: "info", text: parts.join(" · ") };
  }
  if (p.badge === "PAID") {
    const paid = fill(d.payPaid, { amount: euro(p.amountCents) });
    return { tone: "ok", text: p.balanceCents > 0 ? `${paid} · ${fill(d.payBalanceInline, { amount: euro(p.balanceCents) })}` : paid };
  }
  return { tone: "bad", text: d.payNotCompleted };
}
