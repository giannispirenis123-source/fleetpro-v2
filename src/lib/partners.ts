// src/lib/partners.ts
// Ποιος συνεργάτης χρεώνεται μια κράτηση — server-side.
//
// Ο κανόνας σε μία πρόταση: αν την κράτηση τη γράφει συνεργάτης, είναι
// δική του και τίποτα από το body δεν το αλλάζει· αν τη γράφει η εταιρία,
// ο διαχειριστής μπορεί να τη δέσει σε έναν από ΤΟΥΣ ΔΙΚΟΥΣ ΤΗΣ
// συνεργάτες, ή σε κανέναν.

import { db } from "./db";
import type { Viewer } from "./authz";

export type PartnerResolution =
  | { ok: true; partnerId: string | null }
  | { ok: false; message: string };

export async function resolvePartnerId(opts: {
  viewer: Viewer;
  /** Ό,τι έστειλε η φόρμα. Αγνοείται τελείως όταν ο χρήστης είναι συνεργάτης. */
  requested?: string | null;
  /** Η τρέχουσα τιμή, όταν πρόκειται για ενημέρωση. */
  current?: string | null;
}): Promise<PartnerResolution> {
  const { viewer, requested, current } = opts;

  // Ο συνεργάτης χρεώνεται πάντα τον εαυτό του. Ούτε ανεβάζει κράτηση σε
  // άλλον, ούτε την αποσυνδέει από τον εαυτό του.
  if (viewer.role === "PARTNER") {
    return { ok: true, partnerId: viewer.userId };
  }

  // Δεν στάλθηκε τίποτα: ό,τι ίσχυε μένει.
  if (requested === undefined) {
    return { ok: true, partnerId: current ?? null };
  }

  // Ρητά «κανένας».
  if (requested === null || requested === "") {
    return { ok: true, partnerId: null };
  }

  const partner = await db.user.findFirst({
    where: {
      id: requested,
      tenantId: viewer.tenantId!,
      role: "PARTNER",
      isActive: true,
    },
    select: { id: true },
  });

  if (!partner) {
    return { ok: false, message: "Ο συνεργάτης δεν βρέθηκε" };
  }

  return { ok: true, partnerId: partner.id };
}

/** Οι ενεργοί συνεργάτες της εταιρίας, για το dropdown της φόρμας. */
export async function listPartners(tenantId: string) {
  const partners = await db.user.findMany({
    where: { tenantId, role: "PARTNER", isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, commissionRate: true },
  });

  return partners.map((p) => ({
    id: p.id,
    name: p.name,
    commissionRate: Number(p.commissionRate),
  }));
}
