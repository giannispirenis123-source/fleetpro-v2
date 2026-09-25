export const dynamic = "force-dynamic";
// src/app/api/company-users/route.ts
// Οι χρήστες ΤΗΣ ΕΤΑΙΡΙΑΣ — λίστα και δημιουργία.
//
// Ξεχωριστό από το /api/users, που ανήκει στον Super Admin και μιλά για
// όλες τις εταιρίες. Εδώ το tenantId έρχεται ΠΑΝΤΑ από το session και ο
// Super Admin δεν έχει δουλειά — δεν είναι δικοί του χρήστες.

import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ok, created, badRequest, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { MANAGED_ROLES, USER_SELECT, BCRYPT_ROUNDS, toUserDTO } from "@/lib/users";
import { defaultsForRole, permissionsFromKeys } from "@/lib/permissions";

const createUserSchema = z.object({
  name: z.string().min(2, "Απαιτείται όνομα"),
  email: z.string().email("Μη έγκυρο email"),
  password: z.string().min(8, "Τουλάχιστον 8 χαρακτήρες"),
  // Μόνο Προσωπικό ή Συνεργάτης: δεύτερος διαχειριστής δεν φτιάχνεται
  // από εδώ, ώστε να μη γίνεται αθόρυβη αναβάθμιση δικαιωμάτων.
  role: z.enum(MANAGED_ROLES),
  phone: z.union([z.string(), z.null()]).optional(),
  /** Κλειδιά δικαιωμάτων. Αν λείπουν, μπαίνουν οι προεπιλογές της κατηγορίας. */
  permissions: z.array(z.string()).optional(),
});

// GET /api/company-users
export const GET = withPermission(
  async (_req, session) => {
    try {
      const users = await db.user.findMany({
        where: { tenantId: session.tenantId! },
        orderBy: [{ role: "asc" }, { name: "asc" }],
        select: USER_SELECT,
      });

      return ok(users.map(toUserDTO));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "users.view"
);

// POST /api/company-users
export const POST = withPermission(
  async (req, session) => {
    try {
      const parsed = createUserSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;
      const email = data.email.trim().toLowerCase();

      const existing = await db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) return badRequest("Το email χρησιμοποιείται ήδη");

      const permissions = data.permissions
        ? permissionsFromKeys(data.permissions)
        : defaultsForRole(data.role);

      const user = await db.user.create({
        data: {
          tenantId: session.tenantId!,
          name: data.name.trim(),
          email,
          phone: data.phone?.trim() || null,
          passwordHash: await bcrypt.hash(data.password, BCRYPT_ROUNDS),
          role: data.role,
          permissions,
        },
        select: USER_SELECT,
      });

      // Καμία επιστροφή κωδικού ή hash.
      return created({ user: toUserDTO(user) });
    } catch (error) {
      console.error("Δημιουργία χρήστη:", error);
      return serverError();
    }
  },
  "users.create"
);
