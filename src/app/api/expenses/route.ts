export const dynamic = "force-dynamic";
// src/app/api/expenses/route.ts
// Έξοδα εταιρίας — λίστα (με φίλτρα) και καταχώρηση.
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από το session.

import { db } from "@/lib/db";
import { ok, created, badRequest, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { EXPENSE_INCLUDE, toExpenseDTO } from "@/lib/finance";
import {
  expenseSchema,
  loadExpenses,
  parseRange,
  toDate,
  trimOrNull,
  vehicleBelongs,
  vehicleOrNull,
} from "@/lib/financeForm";

// GET /api/expenses?month=YYYY-MM | from=&to=  [&type=][&vehicleId=]
export const GET = withPermission(
  async (req, session) => {
    try {
      const params = new URL(req.url).searchParams;
      const parsed = parseRange(params);
      if (!parsed.ok) return badRequest(parsed.message);

      const expenses = await loadExpenses(session.tenantId!, {
        range: parsed.range,
        type: params.get("type"),
        vehicleId: params.get("vehicleId"),
      });

      return ok({ expenses, range: parsed.range });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "finance.view"
);

// POST /api/expenses
export const POST = withPermission(
  async (req, session) => {
    try {
      const parsed = expenseSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return badRequest(
          parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα",
          parsed.error.errors
        );
      }

      const data = parsed.data;
      const vehicleId = vehicleOrNull(data.vehicleId);

      // Όχημα άλλης εταιρίας δεν δέχεται έξοδο, ό,τι id κι αν σταλεί.
      if (vehicleId && !(await vehicleBelongs(vehicleId, session.tenantId!))) {
        return badRequest("Το όχημα δεν βρέθηκε");
      }

      const expense = await db.expense.create({
        data: {
          tenantId: session.tenantId!,
          type: data.type,
          amount: data.amount,
          date: toDate(data.date),
          vehicleId,
          notes: trimOrNull(data.notes),
        },
        include: EXPENSE_INCLUDE,
      });

      return created({ expense: toExpenseDTO(expense) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "finance.create"
);
