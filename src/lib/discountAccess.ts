// src/lib/discountAccess.ts
// Ποιοι κωδικοί έκπτωσης φαίνονται/αλλάζουν και τι επιτρέπεται στον συνεργάτη —
// ΜΟΝΟ server. Ο Διαχειριστής και το Προσωπικό: όλοι οι κωδικοί της εταιρίας,
// όπως πριν. Ο Συνεργάτης: ΜΟΝΟ όσους δημιούργησε ο ίδιος (createdById, SQL 39),
// με έκπτωση ως την προμήθειά του (checkPartnerDiscount, commission.ts).

import type { Viewer } from "./authz";
import { checkPartnerDiscount, NO_COMMISSION, type CommissionSettings } from "./commission";
import { myCommissionSettings } from "./listServer";

/** Το φίλτρο της βάσης για κάθε ερώτημα κωδικών (λίστα, λεπτομέρεια, επεξεργασία). */
export function discountScope(viewer: Viewer): { tenantId: string; createdById?: string } {
  const base = { tenantId: viewer.tenantId! };
  return viewer.role === "PARTNER" ? { ...base, createdById: viewer.userId } : base;
}

/** Οι ρυθμίσεις προμήθειας του συνεργάτη (ίδιες με τα «Οικονομικά»). Μη συνεργάτης → null. */
export async function partnerCommission(viewer: Viewer): Promise<CommissionSettings | null> {
  if (viewer.role !== "PARTNER") return null;
  return (await myCommissionSettings(viewer, true)) ?? NO_COMMISSION;
}

/** Μήνυμα 400 (ΕΛ — όπως όλα τα μηνύματα των API), ή null αν ο κωδικός επιτρέπεται. */
export function partnerDiscountProblem(
  data: { type: string; value: number; target: string },
  settings: CommissionSettings | null
): string | null {
  if (!settings) return null; // όχι συνεργάτης: καμία αλλαγή
  if (data.target !== "ALL") return "Ο συνεργάτης δημιουργεί μόνο κωδικούς για όλους τους πελάτες.";
  const check = checkPartnerDiscount(data.type, data.value, settings);
  if (check.ok) return null;
  if (check.reason === "fixed_amount") return "Ο συνεργάτης δημιουργεί μόνο κωδικούς με ποσοστό (%).";
  return `Η έκπτωση δεν μπορεί να ξεπερνά την προμήθειά σου (${formatPercent(check.max)}).`;
}

const formatPercent = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")}%`;
