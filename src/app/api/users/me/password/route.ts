export const dynamic = "force-dynamic";
// src/app/api/users/me/password/route.ts
// Αλλαγή του ΔΙΚΟΥ ΜΑΣ κωδικού. Το id έρχεται από το session, ποτέ από το
// request — κανείς δεν αλλάζει τον κωδικό άλλου από εδώ.
//
// Απαιτείται ο τρέχων κωδικός: χωρίς αυτόν, όποιος βρει ανοιχτή συνεδρία
// (κλεμμένο cookie, ξεκλείδωτος υπολογιστής) θα κλείδωνε τον λογαριασμό.
// Διαθέσιμο σε κάθε συνδεδεμένο ρόλο, Super Admin συμπεριλαμβανομένου.

import { passwordChangeStamp } from "@/lib/viewerCore";
import { setSessionCookie } from "@/lib/sessionCookie";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, serverError, logError } from "@/lib/api";

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

    // passwordChangedAt (SQL 41): κάθε ΑΛΛΗ ανοιχτή σύνδεση του χρήστη παύει να ισχύει.
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS), passwordChangedAt: passwordChangeStamp() },
    });

    // Η ΤΡΕΧΟΥΣΑ συσκευή μένει συνδεδεμένη: νέο cookie, εκδομένο μετά την αλλαγή.
    // Κανένας κωδικός ή hash στην απάντηση.
    const response = ok({ changed: true });
    await setSessionCookie(response, {
      userId: session.userId,
      email: session.email,
      role: session.role,
      tenantId: session.tenantId,
      tenantSlug: session.tenantSlug,
      name: session.name,
      locale: session.locale,
    });
    return response;
  } catch (error) {
    // Σκόπιμα δεν περνάμε το body στο log.
    logError("Own password change failed", error);
    return serverError();
  }
});
