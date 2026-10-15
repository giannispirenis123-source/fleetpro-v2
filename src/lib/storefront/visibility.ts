// src/lib/storefront/visibility.ts
// ΜΙΑ πηγή αλήθειας για το «είναι η δημόσια σελίδα ανοιχτή;» — καθαρή λογική.
//
// Τη χρησιμοποιούν ΚΑΙ το δημόσιο site (resolveStorefrontCompany → 404) ΚΑΙ
// το dashboard («Η σελίδα μου» → «Εμφάνιση», όπου ο Διαχειριστής βλέπει τον
// λόγο). Στο δημόσιο ο λόγος ΔΕΝ φαίνεται ποτέ: ίδιο 404 για όλους· γράφεται
// μόνο στα logs του server (χωρίς προσωπικά δεδομένα), για διάγνωση.
//
// Ανοιχτή = υπάρχει slug ΚΑΙ tenants."storefrontEnabled" (ο διακόπτης «Η σελίδα
// είναι ενεργή») ΚΑΙ το πακέτο έχει publicSite ΚΑΙ η εταιρία δεν είναι
// ανασταλμένη/ακυρωμένη.

import { resolveEntitlements } from "../entitlementsCore";

export type HiddenReason = "unknown_slug" | "no_slug" | "disabled" | "no_public_site" | "suspended";

export type Visibility = { open: true } | { open: false; reason: HiddenReason };

export interface VisibilitySource {
  storefrontSlug: string | null;
  storefrontEnabled: boolean;
  status: string;
  /** Από resolveEntitlements (πακέτο + overrides). */
  publicSite: boolean;
}

const HIDDEN_STATUSES = new Set(["SUSPENDED", "CANCELLED"]);

export function storefrontVisibility(t: VisibilitySource | null): Visibility {
  if (!t) return { open: false, reason: "unknown_slug" };
  if (!t.storefrontSlug) return { open: false, reason: "no_slug" };
  if (HIDDEN_STATUSES.has(t.status)) return { open: false, reason: "suspended" };
  if (!t.publicSite) return { open: false, reason: "no_public_site" };
  if (!t.storefrontEnabled) return { open: false, reason: "disabled" };
  return { open: true };
}

/** Για τον Διαχειριστή (dashboard) — ΠΟΤΕ στο δημόσιο site. */
export const HIDDEN_REASON_TEXT: Record<HiddenReason, { el: string; en: string }> = {
  unknown_slug: { el: "Δεν βρέθηκε η διεύθυνση.", en: "Address not found." },
  no_slug: { el: "Βάλε διεύθυνση σελίδας (slug) και αποθήκευσε.", en: "Set a page address (slug) and save." },
  disabled: {
    el: "Η σελίδα δεν είναι ενεργή: άνοιξε τον διακόπτη «Η σελίδα είναι ενεργή» στην καρτέλα «Σελίδα» και αποθήκευσε.",
    en: "The page is not active: turn on “The page is active” in the “Page” tab and save.",
  },
  no_public_site: { el: "Το πακέτο της εταιρίας δεν περιλαμβάνει δημόσια σελίδα.", en: "The company plan does not include a public site." },
  suspended: { el: "Η εταιρία είναι σε αναστολή.", en: "The company is suspended." },
};

/** Η γραμμή της εταιρίας όπως τη φέρνει το resolveStorefrontCompany. */
export interface StorefrontRow {
  storefrontEnabled: boolean;
  storefrontSlug: string | null;
  status: string;
  entitlementPlan: Parameters<typeof resolveEntitlements>[0];
  entitlementOverrides: unknown;
}

/** Γραμμή βάσης → ανοιχτή ή ο λόγος (πακέτο + overrides μέσω resolveEntitlements). */
export function storefrontRowVisibility(row: StorefrontRow | null): Visibility {
  if (!row) return storefrontVisibility(null);
  return storefrontVisibility({
    storefrontSlug: row.storefrontSlug,
    storefrontEnabled: row.storefrontEnabled,
    status: row.status,
    publicSite: resolveEntitlements(row.entitlementPlan, row.entitlementOverrides as never).modules.publicSite,
  });
}
