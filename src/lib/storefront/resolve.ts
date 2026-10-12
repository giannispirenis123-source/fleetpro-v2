// src/lib/storefront/resolve.ts
// Η δημόσια σελίδα — ΜΟΝΟ server.
//
// ΑΣΦΑΛΕΙΑ: η εταιρία βρίσκεται ΜΟΝΟ εδώ, στο resolveStorefrontCompany.
// Σήμερα από το slug· αργότερα θα προστεθεί εδώ (και μόνο εδώ) η εύρεση από
// custom domain. Κάθε άλλο ερώτημα του site φιλτράρει με το companyId που
// επέστρεψε αυτή η συνάρτηση — ποτέ με κάτι από το URL.
//
// Ανενεργή σελίδα, πακέτο χωρίς publicSite, ανασταλμένη/ακυρωμένη εταιρία ή
// άγνωστο slug → null → 404, ΧΩΡΙΣ να φανερώνεται ότι η εταιρία υπάρχει.

import { db } from "../db";
import { signUrls } from "../storage";
import { resolveEntitlements } from "../entitlementsCore";
import { validateSlug } from "./slug";
import {
  PUBLIC_VEHICLE_SELECT,
  toPublicCompany,
  toPublicVehicle,
  type PublicCompany,
  type PublicVehicle,
} from "./publicData";

export interface ResolvedStorefront {
  /** Εσωτερικό — μόνο για τα ερωτήματα του server, ποτέ στη σελίδα. */
  companyId: string;
  company: PublicCompany;
}

const HIDDEN_STATUSES = new Set(["SUSPENDED", "CANCELLED"]);

export async function resolveStorefrontCompany(
  rawSlug: string
): Promise<ResolvedStorefront | null> {
  const check = validateSlug(rawSlug);
  // Το URL έρχεται ήδη πεζό από τα links μας· ό,τι δεν είναι ακριβώς ένα
  // έγκυρο slug δεν ψάχνεται καν στη βάση.
  if (!check.ok || check.slug !== rawSlug) return null;

  const tenant = await db.tenant.findUnique({
    where: { storefrontSlug: check.slug },
    select: {
      id: true,
      status: true,
      storefrontEnabled: true,
      storefrontSlug: true,
      storefrontSettings: true,
      name: true,
      brandColor: true,
      phone: true,
      email: true,
      address: true,
      region: true,
      logoPath: true,
      entitlementOverrides: true,
      entitlementPlan: { select: { key: true, name: true, modules: true, limits: true } },
    },
  });

  if (!tenant || !tenant.storefrontEnabled || HIDDEN_STATUSES.has(tenant.status)) return null;
  const entitlements = resolveEntitlements(tenant.entitlementPlan, tenant.entitlementOverrides);
  if (!entitlements.modules.publicSite) return null;

  const logoUrl = tenant.logoPath
    ? ((await signUrls([tenant.logoPath])).get(tenant.logoPath) ?? null)
    : null;

  return { companyId: tenant.id, company: toPublicCompany(tenant, logoUrl) };
}

/** Τα οχήματα του site: ενεργά, όχι «Ανενεργό», με publicVisible. */
const publicVehicleWhere = (companyId: string) => ({
  tenantId: companyId,
  isActive: true,
  publicVisible: true,
  status: { not: "INACTIVE" as const },
});

export async function loadPublicVehicles(companyId: string): Promise<PublicVehicle[]> {
  const rows = await db.vehicle.findMany({
    where: publicVehicleWhere(companyId),
    select: PUBLIC_VEHICLE_SELECT,
    orderBy: [{ dailyRate: "asc" }, { brand: "asc" }, { model: "asc" }],
  });
  return rows.map(toPublicVehicle);
}

export async function loadPublicVehicle(
  companyId: string,
  vehicleId: string
): Promise<PublicVehicle | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(vehicleId)) return null;
  const row = await db.vehicle.findFirst({
    where: { id: vehicleId, ...publicVehicleWhere(companyId) },
    select: PUBLIC_VEHICLE_SELECT,
  });
  return row ? toPublicVehicle(row) : null;
}
