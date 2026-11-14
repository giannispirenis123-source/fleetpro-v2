export const dynamic = "force-dynamic";
// src/app/api/users/me/password/route.ts
// Αλλαγή του ΔΙΚΟΥ ΜΑΣ κωδικού. Το id έρχεται από το session, ποτέ από το
// request — κανείς δεν αλλάζει τον κωδικό άλλου από εδώ.
//
// Απαιτείται ο τρέχων κωδικός: χωρίς αυτόν, όποιος βρει ανοιχτή συνεδρία
// (κλεμμένο cookie, ξεκλείδωτος υπολογιστής) θα κλείδωνε τον λογαριασμό.
// Διαθέσιμο σε κάθε συνδεδεμένο ρόλο, Super Admin συμπεριλαμβανομένου.
//
// Όριο: 5 προσπάθειες / 15΄ ανά χρήστη (passwordChangePerUser) → 429. Μετράει
// ΚΑΘΕ προσπάθεια, πριν από τον έλεγχο του τρέχοντος κωδικού.

import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { withAuth, ok, badRequest, notFound, serverError, logError } from "@/lib/api";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";

/** Ίδια rounds με το seed, το POST /api/users και το reset του Super Admin. */
const BCRYPT_ROUNDS = 12;

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Απαιτείται ο τρέχων κωδικός"),
  newPassword: z.string().min(8, "Τουλάχιστον 8 χαρακτήρες"),
});

// PATCH /api/users/me/password
export const PATCH = withAuth(async (req, session) => {
  try {
    const parsed = changePasswordSchema.safeParse(await req.json());

    if (!parsed.success) {
      return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
    }

    const { currentPassword, newPassword } = parsed.data;

    if (!(await hitLimit(dbCounterStore, LIMITS.passwordChangePerUser, session.userId))) {
      return NextResponse.json(
        { success: false, message: "Πολλές προσπάθειες. Δοκιμάστε ξανά σε 15 λεπτά." },
        { status: 429 }
      );
    }

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) return notFound("Ο χρήστης δεν βρέθηκε");

    const currentIsValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentIsValid) {
      return badRequest("Ο τρέχων κωδικός δεν είναι σωστός");
    }

    // Αλλαγή σε ίδιο κωδικό δεν προσφέρει τίποτα και συνήθως είναι λάθος
    // του χρήστη — καλύτερα να το πούμε παρά να δείξουμε ψεύτικη επιτυχία.
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      return badRequest("Ο νέος κωδικός είναι ίδιος με τον τρέχοντα");
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
    });

    // Κανένας κωδικός ή hash στην απάντηση.
    return ok({ changed: true });
  } catch (error) {
    // Σκόπιμα δεν περνάμε το body στο log.
    logError("Own password change failed", error);
    return serverError();
  }
});
