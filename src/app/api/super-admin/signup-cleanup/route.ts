export const dynamic = "force-dynamic";
// src/app/api/super-admin/signup-cleanup/route.ts
// Ανεπιβεβαίωτες εγγραφές > 7 ημέρες — ΜΟΝΟ Super Admin.
// GET: η λίστα. POST: ΜΟΝΟ σήμανση (cleanupFlaggedAt)· καμία αυτόματη διαγραφή.
// Η ίδια λογική (unverifiedSignups / flagUnverifiedSignups) είναι έτοιμη για cron.

import { withAuth, ok, serverError, logError } from "@/lib/api";
import { flagUnverifiedSignups, unverifiedSignups } from "@/lib/signup/signupServer";

export const GET = withAuth(async () => {
  try {
    return ok({ items: await unverifiedSignups() });
  } catch (error) {
    logError("signup-cleanup", error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);

export const POST = withAuth(async () => {
  try {
    const flagged = await flagUnverifiedSignups();
    return ok({ flagged, items: await unverifiedSignups() });
  } catch (error) {
    logError("signup-cleanup", error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);
