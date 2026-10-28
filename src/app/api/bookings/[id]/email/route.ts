export const dynamic = "force-dynamic";
// src/app/api/bookings/[id]/email/route.ts
// POST { kind, force? } — (ξανα)αποστολή του email επιβεβαίωσης/ακύρωσης.
// · Χωρίς force: ίδιος δρόμος με την απόφαση (deliverEmail) — ο έλεγχος ποσών
//   μπορεί να το μπλοκάρει ξανά.
// · force: true = «Αποστολή παρ' όλα αυτά» μετά από μπλοκάρισμα. ΜΟΝΟ ο
//   Διαχειριστής (ρόλος από τη βάση) και μόνο μετά από επιβεβαίωση στο UI·
//   στο ιστορικό γράφεται «forced:<κωδικός>».
// Η εταιρία ΜΟΝΟ από τη συνεδρία· το μήνυμα ξαναχτίζεται από τη βάση.

import { z } from "zod";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest, forbidden, notFound, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { canDecide, deliverEmail } from "@/lib/bookingDecision";
import { MESSAGE_KINDS } from "@/lib/bookingMessages";
import { prismaMessageDeps, publicOrigin } from "@/lib/bookingDecisionServer";
import { emailFromForTenant } from "@/lib/emailSenderServer";

const schema = z.object({ kind: z.enum(MESSAGE_KINDS), force: z.boolean().optional() });

export const POST = withPermission(
  async (req, session, params, viewer) => {
    try {
      const v = viewer!;
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα");
      const { kind, force } = parsed.data;
      if (!canDecide(v.role, v.permissions, kind === "confirm" ? "confirm" : "cancel")) {
        return forbidden("Δεν έχετε δικαίωμα για αυτή την ενέργεια");
      }
      if (force && v.role !== "COMPANY_ADMIN") return forbidden("Μόνο ο Διαχειριστής μπορεί να στείλει παρά την ασυμφωνία.");
      const tenantId = session.tenantId!;
      const b = await db.booking.findFirst({ where: { id: params!.id, tenantId }, select: { id: true } });
      if (!b) return notFound("Η κράτηση δεν βρέθηκε");
      const deps = prismaMessageDeps(tenantId, b.id, v.userId, publicOrigin(req), await emailFromForTenant(tenantId));
      const r = await deliverEmail(kind, deps, { force: force === true });
      if (r.email === "blocked") {
        return NextResponse.json({ success: false, code: "amount_blocked", message: "Η αποστολή μπλοκαρίστηκε: ασυμφωνία ποσού.", ...r }, { status: 409 });
      }
      return ok(r);
    } catch (error) {
      console.error("[FleetPro] booking email", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "bookings.view"
);
