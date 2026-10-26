// src/lib/tenantDeleteCore.ts
// Οριστική διαγραφή εταιρίας από τον Super Admin — ΚΑΘΑΡΗ λογική (χωρίς
// runtime imports), για server, client και tests. Η διαγραφή με τη βάση:
// tenantDelete.ts.
//
// · ΚΑΘΕ πίνακας με "tenantId" πρέπει να είναι στη λίστα TENANT_TABLES (ή
//   στη TENANT_TABLES_SPECIAL)· το test tests/tenant-delete.test.mjs βρίσκει
//   μόνο του τους πίνακες από το schema.prisma και αποτυγχάνει αν ξεχαστεί κάποιος.
// · Η σειρά είναι «παιδιά πρώτα», ώστε να μην εξαρτάται από τα ON DELETE της
//   βάσης (bookings → vehicles/customers είναι RESTRICT).

/** Πίνακες με "tenantId", με τη σειρά διαγραφής (παιδιά πρώτα). */
export const TENANT_TABLES = [
  "booking_payments",
  "booking_notifications",
  "invoices",
  "contracts",
  "damages",
  "service_records",
  "expenses",
  "activity_logs",
  "notifications",
  "reviews",
  "rates",
  "bookings",
  "customers",
  "vehicles",
  "extras",
  "discounts",
  "promotions",
  "driver_age_bands",
  "seasons",
  "places", // + place_locations (CASCADE)
  "pickup_locations",
  "rental_groups",
  "contract_templates",
  "site_legal_texts",
  "platform_discounts",
  "founder_invoices",
  "founder_full_charges",
  "tenant_feedback",
  "users", // + sessions, email_verification_tokens (CASCADE) — ελευθερώνονται τα emails
] as const;

/**
 * Πίνακες με "tenantId" που ΔΕΝ σβήνονται τυφλά:
 * · founder_claims: η θέση ιδρυτή ΜΕΝΕΙ πιασμένη (tenantId → NULL), εκτός αν
 *   ζητηθεί «Απελευθέρωση θέσης ιδρυτή» (σβήνεται + μετρητής − 1).
 */
export const TENANT_TABLES_SPECIAL = ["founder_claims"] as const;

/** Καταστάσεις με ζωντανή συνδρομή στο Stripe → η διαγραφή μπλοκάρεται. */
export const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid", "paused"] as const;

export const CANCEL_SUBSCRIPTION_FIRST = "Ακύρωσε πρώτα τη συνδρομή της εταιρίας στο Stripe και ξαναδοκίμασε.";
export const NAME_MISMATCH = "Το όνομα δεν ταιριάζει. Δεν διαγράφηκε τίποτα.";

export interface DeleteGuardInput {
  billingStatus: string;
  stripeSubId: string | null;
}

/** null = επιτρέπεται· αλλιώς το μήνυμα για τον Super Admin. */
export function deleteBlockReason(t: DeleteGuardInput): string | null {
  if (t.stripeSubId && (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(t.billingStatus)) {
    return CANCEL_SUBSCRIPTION_FIRST;
  }
  return null;
}

/** Το όνομα πρέπει να γραφτεί ΑΚΡΙΒΩΣ (μόνο κενά στις άκρες αγνοούνται). */
export const nameConfirmed = (typed: unknown, actual: string): boolean =>
  typeof typed === "string" && typed.trim() !== "" && typed.trim() === actual.trim();

export interface TenantDeleteSummary {
  id: string;
  name: string;
  counts: { users: number; vehicles: number; bookings: number; contracts: number; invoices: number; customers: number };
  blocked: string | null;
  /** Συνδεδεμένος λογαριασμός Stripe Connect → μόνο προειδοποίηση. */
  stripeConnect: boolean;
  founderSlot: number | null;
}
