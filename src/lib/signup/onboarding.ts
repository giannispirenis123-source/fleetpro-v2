// src/lib/signup/onboarding.ts
// Onboarding μετά την εγγραφή — καθαρή λογική (tests χωρίς βάση).
//
// Πέντε βήματα, όλα παραλείψιμα:
//   Α company  — στοιχεία εταιρίας (τηλέφωνο, διεύθυνση, γλώσσες, slug)
//   Β vehicle  — πρώτο όχημα (η υπάρχουσα φόρμα του Στόλου)
//   Γ payments — Stripe Connect (το υπάρχον onboarding, προαιρετικό)
//   Δ publish  — δημοσίευση της σελίδας /s/<slug>
//   Ε domain   — δικό του domain (το υπάρχον «Domain», προαιρετικό)
// «Έγινε» βγαίνει από τα ΠΡΑΓΜΑΤΙΚΑ δεδομένα (οχήματα, Stripe, σελίδα, domain)·
// στη βάση (tenants.onboardingState) μένουν μόνο το Α και οι παραλείψεις.
// Το banner φαίνεται μέχρι να γίνουν τα Α, Β, Δ.

export const ONBOARDING_STEPS = ["company", "vehicle", "payments", "publish", "domain"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const REQUIRED_STEPS: readonly OnboardingStep[] = ["company", "vehicle", "publish"];

export const isOnboardingStep = (v: unknown): v is OnboardingStep =>
  typeof v === "string" && (ONBOARDING_STEPS as readonly string[]).includes(v);

export interface OnboardingState {
  v: 1;
  startedAt: string;
  /** Βήματα που σημειώθηκαν «έγινε» χειροκίνητα (μόνο το Α). */
  done: Partial<Record<OnboardingStep, string>>;
  skipped: OnboardingStep[];
}

export function initialOnboardingState(now = new Date()): OnboardingState {
  return { v: 1, startedAt: now.toISOString(), done: {}, skipped: [] };
}

/** Ό,τι ήρθε από τη βάση (jsonb) → έγκυρη κατάσταση, ή null (καμία λίστα). */
export function normalizeOnboardingState(raw: unknown): OnboardingState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const done: Partial<Record<OnboardingStep, string>> = {};
  if (o.done && typeof o.done === "object") {
    for (const [k, v] of Object.entries(o.done as Record<string, unknown>)) {
      if (isOnboardingStep(k) && typeof v === "string") done[k] = v;
    }
  }
  const skipped = Array.isArray(o.skipped) ? ONBOARDING_STEPS.filter((s) => (o.skipped as unknown[]).includes(s)) : [];
  return { v: 1, startedAt: typeof o.startedAt === "string" ? o.startedAt : new Date(0).toISOString(), done, skipped };
}

/** Τα πραγματικά δεδομένα της εταιρίας (πάντα φιλτραρισμένα με tenantId). */
export interface OnboardingFacts {
  vehicles: number;
  stripeConnected: boolean;
  published: boolean;
  hasDomain: boolean;
}

export interface OnboardingStepView {
  key: OnboardingStep;
  done: boolean;
  skipped: boolean;
  required: boolean;
}

export interface OnboardingView {
  steps: OnboardingStepView[];
  requiredDone: number;
  requiredTotal: number;
  /** Τα Α, Β, Δ έγιναν → χωρίς banner. */
  complete: boolean;
}

export function onboardingView(state: OnboardingState, facts: OnboardingFacts): OnboardingView {
  const isDone: Record<OnboardingStep, boolean> = {
    company: Boolean(state.done.company),
    vehicle: facts.vehicles > 0,
    payments: facts.stripeConnected,
    publish: facts.published,
    domain: facts.hasDomain,
  };
  const steps = ONBOARDING_STEPS.map((key) => ({
    key,
    done: isDone[key],
    skipped: !isDone[key] && state.skipped.includes(key),
    required: REQUIRED_STEPS.includes(key),
  }));
  const requiredDone = REQUIRED_STEPS.filter((k) => isDone[k]).length;
  return { steps, requiredDone, requiredTotal: REQUIRED_STEPS.length, complete: requiredDone === REQUIRED_STEPS.length };
}

export type OnboardingAction = "done" | "skip" | "unskip";

/**
 * Νέα κατάσταση μετά από ενέργεια. «done» γράφεται ΜΟΝΟ για το Α (τα άλλα
 * βγαίνουν από τα δεδομένα· ο client δεν μπορεί να τα «σημειώσει»).
 */
export function applyOnboardingAction(
  state: OnboardingState,
  step: OnboardingStep,
  action: OnboardingAction,
  now = new Date()
): OnboardingState | null {
  if (action === "done") {
    if (step !== "company") return null;
    return { ...state, done: { ...state.done, company: now.toISOString() }, skipped: state.skipped.filter((s) => s !== step) };
  }
  if (action === "skip") {
    return state.skipped.includes(step) ? state : { ...state, skipped: [...state.skipped, step] };
  }
  return { ...state, skipped: state.skipped.filter((s) => s !== step) };
}
