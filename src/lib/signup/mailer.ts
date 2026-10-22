// src/lib/signup/mailer.ts
// Αποστολή των email της εγγραφής — ΜΟΝΟ server. Ο ΙΔΙΟΣ μηχανισμός με τα
// υπόλοιπα email: Resend + EMAIL_FROM, όριο 10΄΄ (TIMEOUTS.email). Ποτέ ρίψη:
// αποτυχία = κωδικός στα logs (χωρίς email/σύνδεσμο), η απάντηση μένει ίδια.
//
// Λειτουργία δοκιμών (SIGNUP_TEST_EMAILS, ΠΟΤΕ στο Vercel Production — βλ.
// flag.ts): τίποτα δεν στέλνεται· το email επιστρέφεται για το E2E.

import { Resend } from "resend";
import { classifyProviderError } from "../invoiceEmail";
import { TIMEOUTS, withTimeout } from "../withTimeout";
import { signupTestEmails } from "./flag";
import type { SignupEmail } from "./signup";

export interface MailResult {
  /** ΜΟΝΟ σε λειτουργία δοκιμών — αλλιώς πάντα undefined. */
  testEmail?: SignupEmail;
}

export async function sendSignupEmail(email: SignupEmail): Promise<MailResult> {
  if (signupTestEmails()) return { testEmail: email };

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("[FleetPro] email εγγραφής: λείπει το RESEND_API_KEY");
    return {};
  }
  const from = process.env.EMAIL_FROM?.trim() || "onboarding@resend.dev";
  try {
    const { error } = await withTimeout(
      new Resend(apiKey).emails.send({ from, to: email.to, subject: email.subject, text: email.text, html: email.html }),
      TIMEOUTS.email,
      "email"
    );
    if (error) console.error(`[FleetPro] email εγγραφής: ${classifyProviderError(error)}`);
  } catch (e) {
    console.error(`[FleetPro] email εγγραφής: ${classifyProviderError(e)}`);
  }
  return {};
}
