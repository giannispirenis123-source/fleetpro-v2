export const dynamic = "force-dynamic";
// src/app/api/company-users/[id]/route.ts
// Επεξεργασία, δικαιώματα, κωδικός και απενεργοποίηση χρήστη της εταιρίας.
//
// Οι ασφαλιστικές δικλείδες, όλες στον server:
//  1. Μόνο χρήστες της ΙΔΙΑΣ εταιρίας — το tenantId από το session.
//  2. Κανείς δεν αλλάζει τα ΔΙΚΑ ΤΟΥ δικαιώματα ή τον ρόλο του.
//  3. Ο ΤΕΛΕΥΤΑΙΟΣ ενεργός διαχειριστής δεν υποβιβάζεται, δεν
//     απενεργοποιείται και δεν σβήνεται — η εταιρία μένει πάντα με ≥1.
//  4. Ο SUPER_ADMIN δεν αγγίζεται από εδώ (δεν έχει καν tenantId).

import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  ok,
  badRequest,
  forbidden,
  notFound,
  serverError,
} from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { MANAGED_ROLES, USER_SELECT, BCRYPT_ROUNDS, toUserDTO } from "@/lib/users";
import { permissionsFromKeys } from "@/lib/permissions";

const updateUserSchema = z
  .object({
    name: z.string().min(2, "Απαιτείται όνομα").optional(),
    email: z.string().email("Μη έγκυρο email").optional(),
    phone: z.union([z.string(), z.null()]).optional(),
    role: z.enum(MANAGED_ROLES).optional(),
    isActive: z.boolean().optional(),
    permissions: z.array(z.string()).optional(),
    /** Νέος κωδικός — ίδιος μηχανισμός hash με παντού αλλού. */
    password: z.string().min(8, "Τουλάχιστον 8 χαρακτήρες").optional(),
    /**
     * Ποσοστό προμήθειας. Ορίζεται ΜΟΝΟ από τον διαχειριστή μέσω αυτής
     * της διαδρομής — ο ίδιος ο συνεργάτης δεν φτάνει ποτέ εδώ, γιατί
     * το users.permissions δεν του δίνεται και ο έλεγχος «όχι ο εαυτός
     * σου» παρακάτω τον κόβει ούτως ή άλλως.
     */
    commissionRate: z.number().min(0).max(100).optional(),
    commissionOnRental: z.boolean().optional(),
    commissionOnExtras: z.boolean().optional(),
    commissionOnInsurance: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Δεν δόθηκε καμία αλλαγή",
  });

/** Πόσοι ενεργοί διαχειριστές μένουν στην εταιρία, εκτός από αυτόν. */
async function otherActiveAdmins(tenantId: string, exceptId: string) {
  return db.user.count({
    where: {
      tenantId,
      role: "COMPANY_ADMIN",
      isActive: true,
      NOT: { id: exceptId },
    },
  });
}

/** Ο χρήστης-στόχος, μόνο αν ανήκει στην εταιρία του αιτούντος. */
async function loadTarget(id: string, tenantId: string) {
  return db.user.findFirst({
    where: { id, tenantId },
    select: { ...USER_SELECT, tenantId: true },
  });
}

// PATCH /api/company-users/[id]
export const PATCH = withPermission(
  async (req, session, params) => {
    try {
      const target = await loadTarget(params!.id, session.tenantId!);
      if (!target) return notFound("Ο χρήστης δεν βρέθηκε");

      const parsed = updateUserSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }
      const data = parsed.data;

      // Κανείς δεν ανεβάζει τον εαυτό του: ούτε δικαιώματα, ούτε ρόλο,
      // ούτε αυτο-απενεργοποίηση.
      const isSelf = target.id === session.userId;
      if (
        isSelf &&
        (data.permissions !== undefined ||
          data.role !== undefined ||
          data.isActive !== undefined ||
          data.commissionRate !== undefined ||
          data.commissionOnRental !== undefined ||
          data.commissionOnExtras !== undefined ||
          data.commissionOnInsurance !== undefined)
      ) {
        return forbidden(
          "Δεν μπορείτε να αλλάξετε τα δικά σας δικαιώματα ή τον ρόλο σας"
        );
      }

      // Ο τελευταίος διαχειριστής μένει διαχειριστής και μένει ενεργός.
      const losesAdmin =
        target.role === "COMPANY_ADMIN" &&
        (data.role !== undefined || data.isActive === false);

      if (losesAdmin) {
        const others = await otherActiveAdmins(session.tenantId!, target.id);
        if (others === 0) {
          return badRequest(
            "Η εταιρία πρέπει να έχει τουλάχιστον έναν ενεργό διαχειριστή"
          );
        }
      }

      if (data.email && data.email.toLowerCase() !== target.email) {
        const clash = await db.user.findUnique({
          where: { email: data.email.toLowerCase() },
          select: { id: true },
        });
        if (clash) return badRequest("Το email χρησιμοποιείται ήδη");
      }

      // Ο διαχειριστής δεν κρατά λίστα δικαιωμάτων: τα έχει όλα.
      const nextRole = data.role ?? target.role;
      const nextPermissions =
        data.permissions !== undefined
          ? nextRole === "COMPANY_ADMIN"
            ? {}
            : permissionsFromKeys(data.permissions)
          : undefined;

      const user = await db.user.update({
        where: { id: target.id },
        data: {
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.email !== undefined && {
            email: data.email.trim().toLowerCase(),
          }),
          ...(data.phone !== undefined && { phone: data.phone?.trim() || null }),
          ...(data.role !== undefined && { role: data.role }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
          ...(data.commissionRate !== undefined && {
            commissionRate: data.commissionRate,
          }),
          ...(data.commissionOnRental !== undefined && {
            commissionOnRental: data.commissionOnRental,
          }),
          ...(data.commissionOnExtras !== undefined && {
            commissionOnExtras: data.commissionOnExtras,
          }),
          ...(data.commissionOnInsurance !== undefined && {
            commissionOnInsurance: data.commissionOnInsurance,
          }),
          ...(nextPermissions !== undefined && { permissions: nextPermissions }),
          ...(data.password !== undefined && {
            passwordHash: await bcrypt.hash(data.password, BCRYPT_ROUNDS),
          }),
          // Ο υποβιβασμός διαχειριστή του δίνει τα δικαιώματα που πλέον
          // χρειάζεται ρητά — αλλιώς θα έμενε με άδειο πεδίο και καμία
          // πρόσβαση, χωρίς να το ζητήσει κανείς.
          ...(data.role !== undefined &&
            target.role === "COMPANY_ADMIN" &&
            data.permissions === undefined && {
              permissions: permissionsFromKeys([]),
            }),
        },
        select: USER_SELECT,
      });

      return ok({ user: toUserDTO(user) });
    } catch (error) {
      console.error("Ενημέρωση χρήστη:", error);
      return serverError();
    }
  },
  "users.permissions"
);

// DELETE /api/company-users/[id] — ήπια διαγραφή (απενεργοποίηση).
// Ο χρήστης κρατά το ιστορικό του· απλώς δεν μπορεί να συνδεθεί.
export const DELETE = withPermission(
  async (_req, session, params) => {
    try {
      const target = await loadTarget(params!.id, session.tenantId!);
      if (!target) return notFound("Ο χρήστης δεν βρέθηκε");

      if (target.id === session.userId) {
        return forbidden("Δεν μπορείτε να διαγράψετε τον εαυτό σας");
      }

      if (target.role === "COMPANY_ADMIN") {
        const others = await otherActiveAdmins(session.tenantId!, target.id);
        if (others === 0) {
          return badRequest(
            "Η εταιρία πρέπει να έχει τουλάχιστον έναν ενεργό διαχειριστή"
          );
        }
      }

      const user = await db.user.update({
        where: { id: target.id },
        data: { isActive: false },
        select: USER_SELECT,
      });

      return ok({ user: toUserDTO(user) });
    } catch (error) {
      console.error("Απενεργοποίηση χρήστη:", error);
      return serverError();
    }
  },
  "users.delete"
);
