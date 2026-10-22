// src/lib/signup/flag.ts
// Διακόπτες της αυτόματης εγγραφής — καθαρή λογική με το env ως παράμετρο.
//
// · SELF_SIGNUP_ENABLED (προεπιλογή OFF): μόνο "true"/"1" ανοίγει /signup,
//   /verify-email, τα endpoints τους και τον σύνδεσμο στο login. Αλλιώς 404.
// · SIGNUP_TEST_EMAILS=1: ΜΟΝΟ για δοκιμές (τοπικά / Vercel Preview). Τα email
//   της εγγραφής ΔΕΝ στέλνονται· επιστρέφονται στην απάντηση του API για να τα
//   διαβάσει το E2E. Στο Vercel Production (VERCEL_ENV=production) δεν
//   ενεργοποιείται ΠΟΤΕ, ό,τι κι αν γράφει το env.

type Env = Record<string, string | undefined>;

const on = (v: string | undefined) => v?.trim().toLowerCase() === "true" || v?.trim() === "1";

export function selfSignupEnabled(env: Env = process.env): boolean {
  return on(env.SELF_SIGNUP_ENABLED);
}

export function signupTestEmails(env: Env = process.env): boolean {
  return on(env.SIGNUP_TEST_EMAILS) && env.VERCEL_ENV !== "production";
}
