export const dynamic = "force-dynamic";
// src/app/api/expenses/[id]/route.ts
// Επεξεργασία και διαγραφή εξόδου.

import { db } from "@/lib/db";
import { ok, badRequest, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { EXPENSE_INCLUDE, toExpenseDTO } from "@/lib/finance";
import {
  expenseUpdateSchema,
  toDate,
  trimOrNull,
  vehicleBelongs,
  vehicleOrNull,
} from "@/lib/financeForm";

// PATCH /api/expenses/[id]
export const PATCH = withPermission(
  async (req, session, params) => {
    try {
      const current = await db.expense.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
        select: { id: true },
      });
      if (!current) return notFound("Το έξοδο δεν βρέθηκε");

      const parsed = expenseUpdateSchema.safeParse(
        await req.json().catch(() => null)
      );
      if (!parsed.success) {
        return badRequest(
          parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα",
          parsed.error.errors
        );
      }

      const data = parsed.data;
      const vehicleId =
        data.vehicleId === undefined ? undefined : vehicleOrNull(data.vehicleId);

      if (vehicleId && !(await vehicleBelongs(vehicleId, session.tenantId!))) {
        return badRequest("Το όχημα δεν βρέθηκε");
      }

      const expense = await db.expense.update({
        where: { id: current.id },
        data: {
          ...(data.type !== undefined && { type: data.type }),
          ...(data.amount !== undefined && { amount: data.amount }),
          ...(data.date !== undefined && { date: toDate(data.date) }),
          ...(vehicleId !== undefined && { vehicleId }),
          ...(data.notes !== undefined && { notes: trimOrNull(data.notes) }),
        },
        include: EXPENSE_INCLUDE,
      });

      return ok({ expense: toExpenseDTO(expense) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "finance.edit"
);

// DELETE /api/expenses/[id] — πραγματική διαγραφή: ένα λάθος καταχωρημένο
// έξοδο δεν το κρατά κανένα άλλο παραστατικό.
export const DELETE = withPermission(
  async (_req, session, params) => {
    try {
      const current = await db.expense.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
        select: { id: true },
      });
      if (!current) return notFound("Το έξοδο δεν βρέθηκε");

      await db.expense.delete({ where: { id: current.id } });

      return ok({ id: current.id });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "finance.delete"
);
