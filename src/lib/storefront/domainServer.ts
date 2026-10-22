// src/lib/storefront/domainServer.ts
// «Η σελίδα μου» → «Domain» — ΜΟΝΟ server. Η εταιρία ΠΑΝΤΑ από τη συνεδρία
// (storefrontAccess)· ένα domain ανήκει σε ΜΙΑ εταιρία (UNIQUE, SQL 33).
// Καμία κλήση στο Vercel API: ο Admin προσθέτει το domain στο Vercel με το χέρι
// και το «Έλεγχος domain» κοιτάζει ΜΟΝΟ το DNS (με όριο χρόνου).

import { Resolver } from "node:dns/promises";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { TIMEOUTS, withTimeout } from "../withTimeout";
import {
  checkDomainAvailability,
  dnsInstructions,
  dnsPointsToApp,
  platformHostsFromEnv,
  readPlatformEnv,
  type DnsAnswer,
  type DnsVerdict,
} from "./domain";

export interface DomainAdminDTO {
  domain: string | null;
  status: "NONE" | "PENDING" | "VERIFIED";
  verifiedAt: string | null;
  slug: string | null;
  /** Η εγγραφή DNS που θα δείξει (και) το Vercel για αυτό το domain. */
  dns: { type: "A" | "CNAME"; name: string; value: string } | null;
}

export async function loadDomainAdmin(companyId: string): Promise<DomainAdminDTO | null> {
  const t = await db.tenant.findUnique({
    where: { id: companyId },
    select: { customDomain: true, customDomainStatus: true, customDomainVerifiedAt: true, storefrontSlug: true },
  });
  if (!t) return null;
  return {
    domain: t.customDomain,
    status: !t.customDomain ? "NONE" : t.customDomainStatus === "VERIFIED" ? "VERIFIED" : "PENDING",
    verifiedAt: t.customDomainVerifiedAt?.toISOString() ?? null,
    slug: t.storefrontSlug,
    dns: t.customDomain ? dnsInstructions(t.customDomain) : null,
  };
}

/** Hosts που δεν δηλώνονται ποτέ: της πλατφόρμας + αυτό από όπου δουλεύει τώρα ο Admin. */
export function forbiddenHosts(currentHost: string | null): string[] {
  const hosts = platformHostsFromEnv(readPlatformEnv());
  return currentHost ? [...hosts, currentHost] : hosts;
}

export type SaveDomainResult =
  | { ok: true }
  | { ok: false; status: 400 | 409; message: string };

/**
 * Νέο domain → PENDING (το site ΔΕΝ σερβίρεται εκεί μέχρι το «Έλεγχος domain»).
 * Το ίδιο domain ξανά → τίποτα δεν αλλάζει (μένει VERIFIED αν ήταν).
 */
export async function saveDomain(companyId: string, input: unknown, currentHost: string | null): Promise<SaveDomainResult> {
  const pre = checkDomainAvailability(input, null, companyId, forbiddenHosts(currentHost));
  if (!pre.ok) return { ok: false, status: 400, message: pre.message };
  const owner = await db.tenant.findFirst({
    where: { customDomain: { equals: pre.domain, mode: "insensitive" } },
    select: { id: true },
  });
  const check = checkDomainAvailability(pre.domain, owner?.id ?? null, companyId, forbiddenHosts(currentHost));
  if (!check.ok) return { ok: false, status: check.reason === "taken" ? 409 : 400, message: check.message };

  const current = await db.tenant.findUnique({ where: { id: companyId }, select: { customDomain: true } });
  if (current?.customDomain === check.domain) return { ok: true };
  try {
    await db.tenant.update({
      where: { id: companyId },
      data: { customDomain: check.domain, customDomainStatus: "PENDING", customDomainVerifiedAt: null },
    });
  } catch (e) {
    // Δύο εταιρίες ταυτόχρονα: το UNIQUE κρίνει.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, status: 409, message: "Αυτό το domain χρησιμοποιείται ήδη από άλλη εταιρία." };
    }
    throw e;
  }
  return { ok: true };
}

/** Αφαίρεση: το site σταματά αμέσως να σερβίρεται στο domain (μένει το /s/<slug>). */
export async function clearDomain(companyId: string): Promise<void> {
  await db.tenant.update({
    where: { id: companyId },
    data: { customDomain: null, customDomainStatus: "PENDING", customDomainVerifiedAt: null },
  });
}

/** Ερωτήματα DNS με όριο χρόνου· σφάλμα/λήξη = «καμία εγγραφή» για εκείνο το είδος. */
export async function lookupDns(host: string, resolver: Pick<Resolver, "resolveCname" | "resolve4"> = defaultResolver()): Promise<DnsAnswer> {
  const safe = <T,>(p: Promise<T[]>) => withTimeout(p, TIMEOUTS.dns, "dns").catch(() => [] as T[]);
  const [cnames, ips] = await Promise.all([safe(resolver.resolveCname(host)), safe(resolver.resolve4(host))]);
  return { cnames, ips };
}

const defaultResolver = () => new Resolver({ timeout: TIMEOUTS.dns, tries: 1 });

export type VerifyResult =
  | { ok: true; verdict: DnsVerdict }
  | { ok: false; status: 400; message: string };

/**
 * «Έλεγχος domain»: ΜΟΝΟ το domain της ίδιας εταιρίας (από τη βάση, ποτέ από
 * το body). Δείχνει στο Vercel → VERIFIED (+ ώρα). Αλλιώς η κατάσταση ΔΕΝ
 * αλλάζει και επιστρέφεται τι βρέθηκε (ένα στιγμιαίο πρόβλημα DNS δεν
 * κατεβάζει ποτέ site που ήδη λειτουργεί· για διακοπή: «Αφαίρεση»).
 */
export async function verifyDomain(
  companyId: string,
  lookup: (host: string) => Promise<DnsAnswer> = (h) => lookupDns(h),
  now = new Date()
): Promise<VerifyResult> {
  const t = await db.tenant.findUnique({ where: { id: companyId }, select: { customDomain: true } });
  if (!t?.customDomain) return { ok: false, status: 400, message: "Δεν έχει οριστεί domain." };
  const verdict = dnsPointsToApp(await lookup(t.customDomain));
  if (verdict.ok) {
    // Μόνο αν το domain δεν άλλαξε στο μεταξύ (ίδιο WHERE).
    await db.tenant.updateMany({
      where: { id: companyId, customDomain: t.customDomain },
      data: { customDomainStatus: "VERIFIED", customDomainVerifiedAt: now },
    });
  }
  return { ok: true, verdict };
}
