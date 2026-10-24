// src/lib/tenantCreate.ts
// ΕΝΑΣ μηχανισμός δημιουργίας εταιρίας — ΜΟΝΟ server. Τον χρησιμοποιούν ο
// Super Admin (POST /api/tenants) ΚΑΙ η αυτόματη εγγραφή (/signup), ώστε μια
// εταιρία από εγγραφή να είναι ίδια με μια από τον Super Admin: ίδιες
// προεπιλογές, ίδιος ρόλος πρώτου χρήστη (COMPANY_ADMIN), ίδιο βασικό συμβόλαιο.
//
// Τρέχει ΜΕΣΑ σε transaction του καλούντος (tenant + χρήστης + πρότυπο μαζί ή
// τίποτα). Ο ρόλος/η κατάσταση/το πακέτο ΔΕΝ έρχονται ποτέ από τον client.

import type { Prisma, SubscriptionPlan } from "@prisma/client";

/** Ίδια rounds με login/αλλαγή κωδικού. */
export const BCRYPT_ROUNDS = 12;

/** Πακέτο (entitlements) όταν δεν διαλέγεται άλλο: όπως όλες οι εταιρίες από το SQL 20. */
export const DEFAULT_PLAN_KEY = "full";

/** Ίδια περίοδος TRIAL με ό,τι έκανε πάντα ο Super Admin. */
export const TRIAL_DAYS = 14;

export type SignupSource = "manual" | "self_signup";

export interface NewTenantInput {
  name: string;
  slug: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  plan?: SubscriptionPlan;
  planKey?: string;
  /** Μόνο η εγγραφή: το /s/<slug> παίρνει το ίδιο slug από την αρχή. */
  storefrontSlug?: string | null;
  signupSource?: SignupSource;
  onboardingState?: Prisma.InputJsonValue;
  /**
   * Μόνο /signup με ενεργό Billing (SQL 36): 'founder_trial' (κωδικός ιδρυτή,
   * 30 ημ. χωρίς κάρτα από το ΠΡΩΤΟ όχημα) ή 'awaiting_checkout' (14 ημ. με
   * κάρτα στο Stripe Checkout). Χωρίς αυτό: 'exempt', όπως πάντα.
   */
  billingStatus?: "founder_trial" | "awaiting_checkout";
  admin: {
    name: string;
    email: string;
    passwordHash: string;
    /** undefined = προεπιλογή της βάσης (now()) · null = περιμένει επαλήθευση (μόνο /signup). */
    emailVerifiedAt?: Date | null;
    locale?: "el" | "en";
  };
}

export async function createTenantWithAdmin(
  tx: Prisma.TransactionClient,
  input: NewTenantInput,
  now = new Date()
) {
  const tenant = await tx.tenant.create({
    data: {
      name: input.name,
      slug: input.slug,
      email: input.email.toLowerCase(),
      phone: input.phone ?? undefined,
      address: input.address ?? undefined,
      plan: input.plan ?? "STARTER",
      planKey: input.planKey ?? DEFAULT_PLAN_KEY,
      status: "TRIAL",
      // Με συνδρομή η λήξη της δοκιμής ορίζεται αργότερα (πρώτο όχημα / Stripe).
      trialEndsAt: input.billingStatus ? null : new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      ...(input.billingStatus ? { billingStatus: input.billingStatus } : {}),
      signupSource: input.signupSource ?? "manual",
      ...(input.storefrontSlug ? { storefrontSlug: input.storefrontSlug } : {}),
      ...(input.onboardingState !== undefined ? { onboardingState: input.onboardingState } : {}),
    },
  });

  const user = await tx.user.create({
    data: {
      tenantId: tenant.id,
      name: input.admin.name,
      email: input.admin.email.toLowerCase(),
      passwordHash: input.admin.passwordHash,
      role: "COMPANY_ADMIN",
      permissions: {},
      ...(input.admin.locale ? { locale: input.admin.locale } : {}),
      ...(input.admin.emailVerifiedAt !== undefined ? { emailVerifiedAt: input.admin.emailVerifiedAt } : {}),
    },
  });

  await tx.contractTemplate.create({
    data: {
      tenantId: tenant.id,
      name: "Βασικό Συμβόλαιο",
      content: defaultContractTemplate(),
      isDefault: true,
      language: "el",
    },
  });

  return { tenant, user };
}

export function defaultContractTemplate(): string {
  return `
<!DOCTYPE html>
<html lang="el">
<head><meta charset="UTF-8"><title>Συμβόλαιο Ενοικίασης</title></head>
<body>
  <h1>ΣΥΜΒΟΛΑΙΟ ΕΝΟΙΚΙΑΣΗΣ ΟΧΗΜΑΤΟΣ</h1>
  <p>Εταιρία: {{company.name}}</p>
  <p>Πελάτης: {{customer.fullName}}</p>
  <p>Όχημα: {{vehicle.brand}} {{vehicle.model}} ({{vehicle.plate}})</p>
  <p>Από: {{booking.pickupDate}} — Έως: {{booking.returnDate}}</p>
  <p>Σύνολο: {{booking.total}}€</p>
  <div class="signature-section">
    <p>Υπογραφή: ____________________</p>
  </div>
</body>
</html>
  `.trim();
}
