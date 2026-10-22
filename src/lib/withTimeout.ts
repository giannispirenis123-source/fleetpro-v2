// src/lib/withTimeout.ts
// Όριο χρόνου για εξωτερικές κλήσεις χωρίς δικό τους timeout (π.χ. το SDK του
// Resend). Καθαρή λογική. Σε λήξη: TimeoutError — ο καλών το χειρίζεται ήπια
// όπως κάθε άλλο σφάλμα του παρόχου (τίποτα δεν «κρεμάει» το αίτημα).

/** Όρια (ms) — ΕΝΑ σημείο για όλη την εφαρμογή. */
export const TIMEOUTS = {
  /** Google Places (κριτικές): αν αργεί, η σελίδα φορτώνει χωρίς αυτές. */
  google: 5_000,
  /** Αποστολή email (Resend). */
  email: 10_000,
  // Supabase Storage: 8΄΄ signed URLs / 10΄΄ διαγραφή / 30΄΄ ανέβασμα — στο storage.ts.
  /** Stripe (κοινός client): ανά προσπάθεια· τα checkout έχουν δικό τους 8΄΄. */
  stripe: 10_000,
  /** DNS lookup του «Έλεγχος domain» (ανά ερώτημα A/CNAME). */
  dns: 5_000,
} as const;

export class TimeoutError extends Error {
  constructor(label = "external call") {
    super(`${label} timed out`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(work: Promise<T>, ms: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
