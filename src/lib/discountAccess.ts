// src/lib/discountAccess.ts
// Ποιοι κωδικοί έκπτωσης φαίνονται/αλλάζουν — ΜΟΝΟ server.
//
// · Κωδικούς δημιουργεί/αλλάζει/απενεργοποιεί ΜΟΝΟ η εταιρία (Διαχειριστής και
//   προσωπικό με δικαίωμα). Ο συνεργάτης: 403 (τα δικαιώματα discounts.create/
//   edit/delete είναι notForPartner στο permissions.ts + ρητός έλεγχος στα routes).
// · Ο κωδικός μπορεί να ΑΝΑΤΕΘΕΙ σε συνεργάτη (discounts."partnerId", SQL 40):
//   τότε η έκπτωση αφαιρείται από την προμήθειά ΤΟΥ (κράτηση από το site).
//   Κανόνες: συνεργάτης ΕΝΕΡΓΟΣ της ΙΔΙΑΣ εταιρίας, μόνο ποσοστό, ≤ την
//   ΤΡΕΧΟΥΣΑ προμήθειά του, για όλους τους πελάτες.
// · Ο συνεργάτης (με «Προβολή εκπτώσεων») βλέπει ΜΟΝΟ όσους του ανατέθηκαν.

import type { Viewer } from "./authz";
import { db } from "./db";
import { checkPartnerDiscount, commissionSettingsOf } from "./commission";
import { normalizeLocale } from "./i18n/locale";

/** Το φίλτρο της βάσης για κάθε ερώτημα κωδικών (λίστα, λεπτομέρεια, επεξεργασία). */
export function discountScope(viewer: Viewer): { tenantId: string; partnerId?: string } {
  const base = { tenantId: viewer.tenantId! };
  return viewer.role === "PARTNER" ? { ...base, partnerId: viewer.userId } : base;
}

export type Msg = { el: string; en: string };

export const formatPercent = (n: number, lang = "el") =>
  `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", lang === "en" ? "." : ",")}%`;

export const ASSIGN_MESSAGES = {
  notFound: { el: "Ο συνεργάτης δεν βρέθηκε.", en: "Partner not found." },
  inactive: { el: "Ο συνεργάτης δεν είναι ενεργός.", en: "The partner is not active." },
  percentOnly: {
    el: "Κωδικός με συνεργάτη: μόνο έκπτωση ποσοστού (%), όχι σταθερό ποσό.",
    en: "Code with a partner: percentage (%) discount only, not a fixed amount.",
  },
  allOnly: {
    el: "Κωδικός με συνεργάτη ισχύει για όλους τους πελάτες.",
    en: "A code with a partner applies to all customers.",
  },
  noCommission: {
    el: "Ο συνεργάτης δεν έχει προμήθεια· δεν μπορεί να του ανατεθεί κωδικός.",
    en: "The partner has no commission; a code cannot be assigned.",
  },
  over: (max: number): Msg => ({
    el: `Η έκπτωση δεν μπορεί να ξεπερνά την προμήθεια του συνεργάτη (${formatPercent(max, "el")}).`,
    en: `The discount cannot exceed the partner's commission (${formatPercent(max, "en")}).`,
  }),
} as const;

/** Ο συνεργάτης όπως τον χρειάζεται ο έλεγχος ανάθεσης. */
export interface AssignablePartner {
  id: string;
  role: string;
  tenantId: string | null;
  isActive: boolean;
  commissionRate: unknown;
  commissionOnRental?: boolean | null;
  commissionOnExtras?: boolean | null;
  commissionOnInsurance?: boolean | null;
}

/**
 * ΚΑΘΑΡΟΣ έλεγχος της ανάθεσης (tests χωρίς βάση). `partner` = ο χρήστης που
 * ΒΡΕΘΗΚΕ με id ΚΑΙ tenantId της εταιρίας (null = δεν υπάρχει ή άλλης εταιρίας —
 * ίδια απάντηση). null επιστροφή = επιτρέπεται.
 */
export function assignmentProblem(
  data: { type: string; value: number; target: string; isActive: boolean },
  partnerId: string | null,
  partner: AssignablePartner | null,
  tenantId: string
): Msg | null {
  if (!partnerId) return null; // κωδικός εταιρίας: όπως πριν
  if (!partner || partner.id !== partnerId || partner.tenantId !== tenantId || partner.role !== "PARTNER") {
    return ASSIGN_MESSAGES.notFound;
  }
  // Ανενεργός κωδικός μπορεί να κρατά τον συνεργάτη (π.χ. απενεργοποιήθηκε μαζί του).
  if (!data.isActive) return null;
  if (!partner.isActive) return ASSIGN_MESSAGES.inactive;
  if (data.target !== "ALL") return ASSIGN_MESSAGES.allOnly;
  const settings = commissionSettingsOf(partner);
  if (data.type !== "PERCENTAGE") return ASSIGN_MESSAGES.percentOnly;
  if (!settings) return ASSIGN_MESSAGES.noCommission;
  const check = checkPartnerDiscount(data.type, data.value, settings);
  if (check.ok) return null;
  return check.reason === "fixed_amount" ? ASSIGN_MESSAGES.percentOnly : ASSIGN_MESSAGES.over(check.max);
}

/** Ο συνεργάτης ΜΟΝΟ της ίδιας εταιρίας (άλλης εταιρίας → null, όπως ανύπαρκτος). */
export async function loadAssignablePartner(tenantId: string, partnerId: string | null): Promise<AssignablePartner | null> {
  if (!partnerId || !/^[A-Za-z0-9_-]{1,64}$/.test(partnerId)) return null;
  return db.user.findFirst({
    where: { id: partnerId, tenantId, role: "PARTNER" },
    select: {
      id: true,
      role: true,
      tenantId: true,
      isActive: true,
      commissionRate: true,
      commissionOnRental: true,
      commissionOnExtras: true,
      commissionOnInsurance: true,
    },
  });
}

/** Η γλώσσα του χρήστη για το μήνυμα 400 (users.locale). */
export async function viewerLang(viewer: Viewer): Promise<"el" | "en"> {
  const u = await db.user.findUnique({ where: { id: viewer.userId }, select: { locale: true } });
  return normalizeLocale(u?.locale);
}
