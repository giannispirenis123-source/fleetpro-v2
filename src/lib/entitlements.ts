// src/lib/entitlements.ts
// Πακέτα (entitlements) — ΜΟΝΟ server. Ο ΕΝΑΣ τόπος όπου διαβάζεται τι
// έχει αγοράσει μια εταιρία. Οι κανόνες συνδυασμού ζουν στο entitlementsCore.ts.
//
// Ο έλεγχος γίνεται ΠΑΝΤΑ στον server (δημιουργία χρήστη/οχήματος, δημόσιες
// σελίδες, «Η σελίδα μου»)· το UI απλώς κρύβει/απενεργοποιεί ό,τι θα απορριπτόταν.
// Οι τιμές διαβάζονται από τη βάση σε κάθε αίτημα: αλλαγή στο "plans" ισχύει
// αμέσως, χωρίς deploy.

import { db } from "./db";
import {
  checkLimit,
  resolveEntitlements,
  type Entitlements,
  type LimitCheck,
  type LimitKind,
  type ModuleKey,
} from "./entitlementsCore";

export {
  NOT_IN_PLAN_MSG,
  type Entitlements,
  type LimitKind,
  type ModuleKey,
} from "./entitlementsCore";

/** Υπέρβαση ορίου ή ενότητα εκτός πακέτου — το message είναι για τον χρήστη. */
export class EntitlementError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "EntitlementError";
  }
}

export async function getEntitlements(companyId: string): Promise<Entitlements> {
  const tenant = await db.tenant.findUnique({
    where: { id: companyId },
    select: {
      entitlementOverrides: true,
      entitlementPlan: {
        select: { key: true, name: true, modules: true, limits: true, active: true },
      },
    },
  });
  if (!tenant) return resolveEntitlements(null, {});
  return resolveEntitlements(tenant.entitlementPlan, tenant.entitlementOverrides);
}

export async function hasModule(companyId: string, module: ModuleKey): Promise<boolean> {
  return (await getEntitlements(companyId)).modules[module];
}

/** Πόσα «πιάνουν θέση» στο όριο: μόνο τα ενεργά. */
async function countUsage(companyId: string, kind: LimitKind): Promise<number> {
  return kind === "users"
    ? db.user.count({ where: { tenantId: companyId, isActive: true } })
    : db.vehicle.count({ where: { tenantId: companyId, isActive: true } });
}

/** Χωράει ακόμα ένας χρήστης/ένα όχημα; Δεν πετά — για το UI και τα API. */
export async function checkWithinLimit(
  companyId: string,
  kind: LimitKind
): Promise<LimitCheck> {
  const entitlements = await getEntitlements(companyId);
  // Απεριόριστο: δεν χρειάζεται καν η μέτρηση.
  if (entitlements.limits[kind] === null) return { ok: true, limit: null, used: 0 };
  return checkLimit(entitlements, kind, await countUsage(companyId, kind));
}

/** Πετά EntitlementError (403, ελληνικό μήνυμα) αν δεν χωράει ακόμα ένα. */
export async function assertWithinLimit(companyId: string, kind: LimitKind): Promise<void> {
  const result = await checkWithinLimit(companyId, kind);
  if (!result.ok) throw new EntitlementError(result.message);
}
