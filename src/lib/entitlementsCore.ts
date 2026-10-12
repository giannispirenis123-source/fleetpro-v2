// src/lib/entitlementsCore.ts
// Πακέτα (entitlements) — καθαρή λογική, ΧΩΡΙΣ runtime imports, ώστε να τη
// φορτώνουν ο server, τα client components και τα unit tests (node:test).
//
// Πηγή αλήθειας για τις ΤΙΜΕΣ είναι η βάση (πίνακας "plans" + τα overrides
// της εταιρίας)· εδώ ζουν μόνο οι κανόνες συνδυασμού:
//
// · modules: μόνο το `true` ανοίγει μια ενότητα· ό,τι λείπει ή είναι άλλο = κλειστό.
// · limits:  αριθμός ≥ 0 = όριο · null ή απόν = απεριόριστο.
// · overrides της εταιρίας υπερισχύουν ανά κλειδί (και `null` στο limit =
//   απεριόριστο μόνο για αυτήν).
// · Εταιρία ΧΩΡΙΣ πακέτο (planKey null ή άγνωστο): καμία ενότητα και όριο 0
//   σε όλα — ασφαλής προεπιλογή· τα overrides ισχύουν κανονικά.

/** Οι ενότητες που μπορεί να «αγοράσει» μια εταιρία. Νέα ενότητα = νέο κλειδί εδώ. */
export const MODULE_KEYS = ["dashboard", "publicSite"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Τα όρια, με το κλειδί τους στο JSON της βάσης. */
export const LIMIT_KEYS = {
  users: "maxUsers",
  vehicles: "maxVehicles",
} as const;
export type LimitKind = keyof typeof LIMIT_KEYS;

export interface PlanRow {
  key: string;
  name?: string;
  modules: unknown;
  limits: unknown;
  active?: boolean;
}

export interface Entitlements {
  /** null = η εταιρία δεν έχει (έγκυρο) πακέτο. */
  planKey: string | null;
  planName: string | null;
  modules: Record<ModuleKey, boolean>;
  /** null = απεριόριστο. */
  limits: Record<LimitKind, number | null>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Έγκυρη τιμή ορίου: ακέραιος ≥ 0 ή null. undefined = «δεν ορίζεται εδώ». */
function readLimit(source: Record<string, unknown>, key: string): number | null | undefined {
  if (!(key in source)) return undefined;
  const v = source[key];
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
  // Χαλασμένη τιμή (κείμενο, αρνητικό): την αγνοούμε, σαν να έλειπε.
  return undefined;
}

/**
 * Συνδυάζει πακέτο + overrides σε τελικά δικαιώματα.
 * `plan` = η γραμμή του πίνακα plans (ή null αν η εταιρία δεν έχει πακέτο).
 */
export function resolveEntitlements(
  plan: PlanRow | null,
  overrides: unknown
): Entitlements {
  const planModules = plan && isObject(plan.modules) ? plan.modules : {};
  const planLimits = plan && isObject(plan.limits) ? plan.limits : {};
  const ov = isObject(overrides) ? overrides : {};
  const ovModules = isObject(ov.modules) ? ov.modules : {};
  const ovLimits = isObject(ov.limits) ? ov.limits : {};

  const modules = {} as Record<ModuleKey, boolean>;
  for (const key of MODULE_KEYS) {
    const value = key in ovModules ? ovModules[key] : planModules[key];
    modules[key] = value === true;
  }

  const limits = {} as Record<LimitKind, number | null>;
  for (const kind of Object.keys(LIMIT_KEYS) as LimitKind[]) {
    const jsonKey = LIMIT_KEYS[kind];
    const fromOverride = readLimit(ovLimits, jsonKey);
    if (fromOverride !== undefined) {
      limits[kind] = fromOverride;
      continue;
    }
    if (!plan) {
      // Χωρίς πακέτο: τίποτα νέο.
      limits[kind] = 0;
      continue;
    }
    const fromPlan = readLimit(planLimits, jsonKey);
    limits[kind] = fromPlan === undefined ? null : fromPlan;
  }

  return {
    planKey: plan?.key ?? null,
    planName: plan?.name ?? null,
    modules,
    limits,
  };
}

export const NOT_IN_PLAN_MSG = "Δεν περιλαμβάνεται στο πακέτο σας";

export type LimitCheck =
  | { ok: true; limit: number | null; used: number }
  | { ok: false; limit: number; used: number; message: string };

const LIMIT_NOUN: Record<LimitKind, [one: string, many: string]> = {
  users: ["χρήστη", "χρήστες"],
  vehicles: ["όχημα", "οχήματα"],
};

/**
 * Χωράει ΑΚΟΜΑ ΕΝΑ; `used` = πόσα (ενεργά) υπάρχουν ήδη.
 * Το μήνυμα είναι έτοιμο για τον χρήστη, στα Ελληνικά.
 */
export function checkLimit(
  entitlements: Entitlements,
  kind: LimitKind,
  used: number
): LimitCheck {
  const limit = entitlements.limits[kind];
  if (limit === null || used < limit) return { ok: true, limit, used };

  const [one, many] = LIMIT_NOUN[kind];
  const message = entitlements.planKey === null
    ? `Η εταιρία δεν έχει ενεργό πακέτο. Επικοινωνήστε μαζί μας για να προσθέσετε ${many}.`
    : limit === 0
      ? `${NOT_IN_PLAN_MSG}: δεν επιτρέπονται ${many}.`
      : `Το πακέτο σας επιτρέπει έως ${limit} ${limit === 1 ? one : many}. ` +
        `Απενεργοποιήστε κάποιο ή επικοινωνήστε μαζί μας για αναβάθμιση.`;
  return { ok: false, limit, used, message };
}

