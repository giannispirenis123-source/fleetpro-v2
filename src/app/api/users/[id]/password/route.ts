export const dynamic = "force-dynamic";
// src/app/api/users/[id]/password/route.ts
// Reset κωδικού χρήστη εταιρίας από τον Super Admin.
//
// Ο κωδικός δεν επιστρέφεται, δεν λογάρεται και δεν αποθηκεύεται πουθενά σε
// καθαρή μορφή — μόνο το bcrypt hash, με τα ίδια rounds (12) που χρησιμοποιούν
// το seed και η δημιουργία χρήστη, ώστε το login να τον δέχεται αυτούσια.

import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  withAuth,
  ok,
  badRequest,
  forbidden,
  notFound,
  serverError,
} from "@/lib/api";

/** Ίδια rounds με prisma/seed.ts και POST /api/users. */
const BCRYPT_ROUNDS = 12;

/** Ρόλοι που επιτρέπεται να δεχτούν reset από εδώ: μόνο χρήστες εταιρίας. */
const RESETTABLE_ROLES = ["COMPANY_ADMIN", "STAFF", "PARTNER"];

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Τουλάχιστον 8 χαρακτήρες"),
});

// PATCH /api/users/[id]/password
export const PATCH = withAuth(
  async (req, _session, params) => {
    try {
      const body = await req.json();
      const parsed = resetPasswordSchema.safeParse(body);

      if (!parsed.success) {
        // Τα μηνύματα του zod αφορούν το μήκος — δεν περιέχουν την τιμή.
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      // Δεν διαβάζουμε passwordHash: δεν το χρειαζόμαστε και δεν θέλουμε
      // να κυκλοφορεί στη μνήμη του handler.
      const user = await db.user.findUnique({
        where: { id: params!.id },
        select: { id: true, email: true, name: true, role: true, tenantId: true },
      });

      if (!user) return notFound("Ο χρήστης δεν βρέθηκε");

      // Ο Super Admin δεν ρεσετάρει άλλον Super Admin από εδώ. Ο έλεγχος
      // γίνεται και στον ρόλο και στο tenantId: ένας χρήστης χωρίς εταιρία
      // είναι χρήστης πλατφόρμας, ό,τι ρόλο κι αν γράφει.
      if (!RESETTABLE_ROLES.includes(user.role) || user.tenantId === null) {
        return forbidden(
          "Επιτρέπεται reset μόνο σε χρήστες εταιρίας (Διαχειριστής, Προσωπικό, Συνεργάτης)"
        );
      }

      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS) },
      });

      // Καμία επιστροφή κωδικού ή hash.
      return ok({ id: user.id, email: user.email, name: user.name });
    } catch (error) {
      // Σκόπιμα δεν περνάμε το body στο log.
      console.error("Password reset failed:", error);
      return serverError();
    }
  },
  ["SUPER_ADMIN"]
);
