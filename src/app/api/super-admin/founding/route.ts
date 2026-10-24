export const dynamic = "force-dynamic";
// src/app/api/super-admin/founding/route.ts
// Πρόγραμμα «Πρώτες 10 εταιρίες» — ΜΟΝΟ Super Admin.
// GET: μετρητής θέσεων, κωδικοί (χωρίς τον κωδικό — μόνο ετικέτα), διεκδικήσεις,
//      ειδοποιήσεις λήξης έκπτωσης που οφείλονται.
// POST: νέος κωδικός (ο κωδικός επιστρέφεται ΜΙΑ φορά).
// PATCH: ενεργός/ανενεργός κωδικός ή πρόγραμμα.

import { withAuth, ok, created, badRequest, notFound, serverError, logError } from "@/lib/api";
import { db } from "@/lib/db";
import { FOUNDING_PROGRAM_ID } from "@/lib/billing/founding";
import { createCodeSchema, createFounderCode, foundingAdminView, updateFoundingSchema } from "@/lib/billing/foundingAdmin";

export const GET = withAuth(async () => {
  try {
    return ok(await foundingAdminView());
  } catch (error) {
    logError("super-admin/founding", error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);

export const POST = withAuth(async (req) => {
  try {
    const parsed = createCodeSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
    return created(await createFounderCode(parsed.data));
  } catch (error) {
    logError("super-admin/founding", error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);

export const PATCH = withAuth(async (req) => {
  try {
    const parsed = updateFoundingSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
    const { codeId, codeActive, programActive } = parsed.data;
    if (codeId && typeof codeActive === "boolean") {
      const r = await db.founderCode.updateMany({ where: { id: codeId }, data: { active: codeActive } });
      if (r.count !== 1) return notFound();
    }
    if (typeof programActive === "boolean") {
      await db.foundingProgram.update({ where: { id: FOUNDING_PROGRAM_ID }, data: { active: programActive, updatedAt: new Date() } });
    }
    return ok(await foundingAdminView());
  } catch (error) {
    logError("super-admin/founding", error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);
