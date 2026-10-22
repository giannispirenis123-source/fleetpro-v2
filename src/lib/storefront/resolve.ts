// src/lib/storefront/resolve.ts
// Η δημόσια σελίδα — ΜΟΝΟ server.
//
// ΑΣΦΑΛΕΙΑ: η εταιρία βρίσκεται ΜΟΝΟ εδώ: από το slug (resolveStorefrontCompany)
// ή από το VERIFIED domain (resolveStorefrontByHost). Κάθε άλλο ερώτημα του
// site φιλτράρει με το companyId που επέστρεψαν αυτές — ποτέ με κάτι από το URL.
//
// Πότε είναι ανοιχτή: ΜΟΝΟ storefrontVisibility (visibility.ts) — ίδιος
// κανόνας με το dashboard. Αλλιώς null → 404, ΧΩΡΙΣ να φανερώνεται ότι η
// εταιρία υπάρχει ή ποιος είναι ο λόγος.

import { headers } from "next/headers";
import { db } from "../db";
import { signUrls } from "../storage";
import { canonicalSlug } from "./slug";
import { DOMAIN_SLUG, normalizeHost, platformOrigin, readPlatformEnv, SITE_HOST_HEADER } from "./domain";
import { storefrontRowVisibility } from "./visibility";
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

const TENANT_SELECT = {
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
  rentalMode: true,
  customDomain: true,
  customDomainStatus: true,
  entitlementOverrides: true,
  entitlementPlan: { select: { key: true, name: true, modules: true, limits: true } },
} as const;

async function finish(
  tenant: Awaited<ReturnType<typeof findTenant>>,
  onDomain: boolean,
  logKey: Record<string, string>
): Promise<ResolvedStorefront | null> {
  const visibility = storefrontRowVisibility(tenant);
  if (!tenant || !visibility.open) {
    // Μόνο στα logs του server (Vercel → Logs): ποιο slug/domain και γιατί. Ο
    // επισκέπτης βλέπει το ίδιο 404 σε κάθε περίπτωση.
    console.info("[FleetPro] site 404", { ...logKey, reason: visibility.open ? "unknown" : visibility.reason });
    return null;
  }

  const logoUrl = tenant.logoPath
    ? ((await signUrls([tenant.logoPath])).get(tenant.logoPath) ?? null)
    : null;

  return {
    companyId: tenant.id,
    company: toPublicCompany(tenant, logoUrl, { onDomain, platformOrigin: platformOrigin(readPlatformEnv()) }),
  };
}

const findTenant = (where: { storefrontSlug: string } | { customDomain: string; customDomainStatus: "VERIFIED" }) =>
  db.tenant.findFirst({ where, select: TENANT_SELECT });

export async function resolveStorefrontCompany(
  rawSlug: string
): Promise<ResolvedStorefront | null> {
  // Το middleware έχει ήδη κάνει redirect σε κανονική μορφή· εδώ ξανά, για
  // ασφάλεια (κεφαλαία/κενά/τόνοι δεν δίνουν 404 σε ενεργή σελίδα).
  const slug = canonicalSlug(rawSlug);
  if (!slug) return null;
  return finish(await findTenant({ storefrontSlug: slug }), false, { slug });
}

/**
 * Η εταιρία του domain: ΜΟΝΟ customDomain = host ΚΑΙ VERIFIED. PENDING,
 * άγνωστο ή domain άλλης εταιρίας που δεν επαληθεύτηκε → null (404).
 */
export async function resolveStorefrontByHost(rawHost: string | null): Promise<ResolvedStorefront | null> {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  return finish(await findTenant({ customDomain: host, customDomainStatus: "VERIFIED" }), true, { host });
}

/**
 * Για τις σελίδες /s/[slug]/…: το [slug] είναι slug, ή DOMAIN_SLUG όταν το
 * middleware μετέφρασε αίτημα domain εταιρίας. Τότε το host ΜΟΝΟ από το
 * SITE_HOST_HEADER — που το βάζει μόνο το middleware (κάθε εισερχόμενο
 * header με αυτό το όνομα σβήνεται). Στο /s/_domain της πλατφόρμας δεν
 * υπάρχει header → 404.
 */
export async function resolveStorefrontParam(param: string): Promise<ResolvedStorefront | null> {
  if (param === DOMAIN_SLUG) return resolveStorefrontByHost(headers().get(SITE_HOST_HEADER));
  return resolveStorefrontCompany(param);
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
