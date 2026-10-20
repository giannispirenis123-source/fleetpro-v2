// src/lib/loginLock.ts
// Κλείδωμα σύνδεσης μετά από 10 ΛΑΘΟΣ κωδικούς — καθαρή λογική με
// εγχυόμενο store (tests χωρίς βάση). Ο store ζει στο rate_limits (κανένα νέο
// SQL): κλειδιά πάντα HASH, ποτέ email/IP σε καθαρή μορφή.
//
// · Μετρούν ΜΟΝΟ τα λάθη, στα τελευταία 15΄ (κυλιόμενο παράθυρο ανά λεπτό).
// · 10 λάθη για ίδιο email ΑΠΟ ΙΔΙΑ IP → κλείδωμα 15΄ (προσωρινό). Έτσι κάποιος
//   που ξέρει το email του Διαχειριστή δεν τον κλειδώνει από αλλού.
// · Δίχτυ για επίθεση από πολλές IP: 100 λάθη ανά email σε 60΄ → κλείδωμα 15΄
//   του email (και πάλι προσωρινό).
// · Ίδια απάντηση για άγνωστο και υπαρκτό χρήστη: το κλείδωμα μετρά ανά email,
//   όχι ανά λογαριασμό. Ένα σωστό login μηδενίζει τα λάθη (email + IP).

import { limitKey } from "./public/rateLimit";

export const LOGIN_LOCK = {
  maxFailures: 10,
  failureWindowMinutes: 15,
  lockMinutes: 15,
  emailMaxFailures: 100,
  emailWindowMinutes: 60,
} as const;

export interface LoginLockStore {
  /** +1 λάθος (κλειδί, τώρα). */
  addFailure(key: string, now: Date): Promise<void>;
  /** Λάθη του κλειδιού από `since` και μετά. */
  failuresSince(key: string, since: Date): Promise<number>;
  /** Μέχρι πότε είναι κλειδωμένο (null = όχι). */
  lockedUntil(key: string, now: Date): Promise<Date | null>;
  lock(key: string, until: Date): Promise<void>;
  clearFailures(key: string): Promise<void>;
}

const norm = (email: string) => email.trim().toLowerCase();
export const pairFailKey = (email: string, ip: string) => limitKey("login-fail", `${norm(email)}|${ip}`);
export const pairLockKey = (email: string, ip: string) => limitKey("login-lock", `${norm(email)}|${ip}`);
export const emailFailKey = (email: string) => limitKey("login-fail-email", norm(email));
export const emailLockKey = (email: string) => limitKey("login-lock-email", norm(email));

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);

/** Κλειδωμένο αυτή τη στιγμή (για αυτό το email από αυτή την IP); */
export async function isLoginLocked(store: LoginLockStore, email: string, ip: string, now = new Date()): Promise<boolean> {
  const [pair, mail] = await Promise.all([
    store.lockedUntil(pairLockKey(email, ip), now),
    store.lockedUntil(emailLockKey(email), now),
  ]);
  return !!pair || !!mail;
}

/**
 * Λάθος κωδικός (ή άγνωστο email). `lockedNow` = με ΑΥΤΟ το λάθος μόλις
 * κλείδωσε (για την ένδειξη στο activity log — μία φορά ανά κλείδωμα).
 */
export async function recordLoginFailure(
  store: LoginLockStore,
  email: string,
  ip: string,
  now = new Date()
): Promise<{ lockedNow: boolean; failures: number }> {
  const pk = pairFailKey(email, ip);
  const ek = emailFailKey(email);
  await Promise.all([store.addFailure(pk, now), store.addFailure(ek, now)]);
  const [pairFails, emailFails] = await Promise.all([
    store.failuresSince(pk, minutesAgo(now, LOGIN_LOCK.failureWindowMinutes)),
    store.failuresSince(ek, minutesAgo(now, LOGIN_LOCK.emailWindowMinutes)),
  ]);
  const until = new Date(now.getTime() + LOGIN_LOCK.lockMinutes * 60_000);
  let lockedNow = false;
  if (pairFails >= LOGIN_LOCK.maxFailures) {
    await store.lock(pairLockKey(email, ip), until);
    // Μετά το κλείδωμα τα λάθη ξεκινούν από την αρχή (νέα δεκάδα μετά τη λήξη).
    await store.clearFailures(pk);
    lockedNow = true;
  }
  if (emailFails >= LOGIN_LOCK.emailMaxFailures) {
    await store.lock(emailLockKey(email), until);
    await store.clearFailures(ek);
    lockedNow = true;
  }
  return { lockedNow, failures: pairFails };
}

/** Σωστή σύνδεση: μηδενίζει τα λάθη αυτού του email από αυτή την IP. */
export async function clearLoginFailures(store: LoginLockStore, email: string, ip: string): Promise<void> {
  await store.clearFailures(pairFailKey(email, ip));
}
