// src/lib/signup/onboardingServer.ts
// Onboarding με τη βάση — ΜΟΝΟ server. Κάθε ερώτημα φιλτράρει με το tenantId
// της ΣΥΝΕΔΡΙΑΣ (ποτέ από body/URL). Η λογική: onboarding.ts.

import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { normalizeStorefrontSettings } from "../storefront/settings";
import {
  applyOnboardingAction,
  normalizeOnboardingState,
  onboardingView,
  type OnboardingAction,
  type OnboardingStep,
  type OnboardingView,
} from "./onboarding";

export interface OnboardingDTO {
  view: OnboardingView;
  company: { name: string; phone: string; address: string };
  storefront: { slug: string | null; enabled: boolean; supportedLanguages: string[]; defaultLanguage: string };
  hasDomain: boolean;
}

/** null = η εταιρία δεν έχει onboarding (π.χ. από τον Super Admin). */
export async function loadOnboarding(tenantId: string): Promise<OnboardingDTO | null> {
  const t = await db.tenant.findUnique({
    where: { id: tenantId },
    select: {
      name: true,
      phone: true,
      address: true,
      onboardingState: true,
      storefrontSlug: true,
      storefrontEnabled: true,
      storefrontSettings: true,
      stripeAccountId: true,
      customDomain: true,
      _count: { select: { vehicles: { where: { isActive: true } } } },
    },
  });
  const state = normalizeOnboardingState(t?.onboardingState);
  if (!t || !state) return null;
  const settings = normalizeStorefrontSettings(t.storefrontSettings);
  return {
    view: onboardingView(state, {
      vehicles: t._count.vehicles,
      stripeConnected: Boolean(t.stripeAccountId),
      published: t.storefrontEnabled && Boolean(t.storefrontSlug),
      hasDomain: Boolean(t.customDomain),
    }),
    company: { name: t.name, phone: t.phone ?? "", address: t.address ?? "" },
    storefront: {
      slug: t.storefrontSlug,
      enabled: t.storefrontEnabled,
      supportedLanguages: settings.supportedLanguages,
      defaultLanguage: settings.defaultLanguage,
    },
    hasDomain: Boolean(t.customDomain),
  };
}

/** Για το banner του dashboard: μόνο η πρόοδος (ένα ελαφρύ ερώτημα). */
export async function onboardingBanner(tenantId: string): Promise<{ done: number; total: number } | null> {
  const dto = await loadOnboarding(tenantId);
  if (!dto || dto.view.complete) return null;
  return { done: dto.view.requiredDone, total: dto.view.requiredTotal };
}

export async function updateOnboarding(
  tenantId: string,
  step: OnboardingStep,
  action: OnboardingAction
): Promise<"ok" | "none" | "invalid"> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { onboardingState: true } });
  const state = normalizeOnboardingState(t?.onboardingState);
  if (!state) return "none";
  const next = applyOnboardingAction(state, step, action);
  if (!next) return "invalid";
  await db.tenant.update({
    where: { id: tenantId },
    data: { onboardingState: next as unknown as Prisma.InputJsonValue },
  });
  return "ok";
}
