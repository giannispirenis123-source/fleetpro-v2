// src/lib/storefront/admin.ts
// «Η σελίδα μου» (dashboard) — ΜΟΝΟ server. Κοινό για τη σελίδα και το API.
//
// Πρόσβαση: ΜΟΝΟ Διαχειριστής εταιρίας (ρόλος από τη βάση) ΚΑΙ πακέτο με
// publicSite. Η εταιρία πάντα από τη συνεδρία — ποτέ από το body/URL.

import { db } from "../db";
import { hasModule, NOT_IN_PLAN_MSG } from "../entitlements";
import type { Viewer } from "../authz";
import { normalizeStorefrontSettings, type StorefrontSettings } from "./settings";

export interface StorefrontAdminDTO {
  enabled: boolean;
  slug: string | null;
  settings: StorefrontSettings;
}

export type StorefrontAccess =
  | { ok: true; companyId: string }
  | { ok: false; status: 403; message: string };

export async function storefrontAccess(viewer: Viewer | undefined): Promise<StorefrontAccess> {
  if (!viewer?.tenantId || viewer.role !== "COMPANY_ADMIN") {
    return { ok: false, status: 403, message: "Μόνο ο Διαχειριστής της εταιρίας έχει πρόσβαση" };
  }
  if (!(await hasModule(viewer.tenantId, "publicSite"))) {
    return { ok: false, status: 403, message: NOT_IN_PLAN_MSG };
  }
  return { ok: true, companyId: viewer.tenantId };
}

export async function loadStorefrontAdmin(companyId: string): Promise<StorefrontAdminDTO | null> {
  const t = await db.tenant.findUnique({
    where: { id: companyId },
    select: { storefrontEnabled: true, storefrontSlug: true, storefrontSettings: true },
  });
  if (!t) return null;
  return {
    enabled: t.storefrontEnabled,
    slug: t.storefrontSlug,
    settings: normalizeStorefrontSettings(t.storefrontSettings),
  };
}

/** Ποια εταιρία έχει ήδη αυτό το slug (id ή null). */
export async function slugOwner(slug: string): Promise<string | null> {
  const t = await db.tenant.findUnique({ where: { storefrontSlug: slug }, select: { id: true } });
  return t?.id ?? null;
}
