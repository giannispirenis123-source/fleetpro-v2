export const dynamic = "force-dynamic";
// src/app/api/extras/route.ts
// Πρόσθετα & ασφάλειες ανά tenant

import { z } from "zod";
import { db } from "@/lib/db";
import {
  withAuth,
  ok,
  created,
  badRequest,
  serverError,
} from "@/lib/api";
import { CHARGE_TYPES, EXTRA_TYPES, toExtraDTO } from "@/lib/extras";

const createExtraSchema = z.object({
  name: z.string().min(1, "Απαιτείται όνομα"),
  price: z.number().min(0, "Μη αρνητική τιμή"),
  chargeType: z.enum(CHARGE_TYPES).default("PER_DAY"),
  type: z.enum(EXTRA_TYPES).default("EXTRA"),
  isActive: z.boolean().default(true),
});

// GET /api/extras — λίστα για τον tenant
export const GET = withAuth(
  async (req, session) => {
    try {
      const url = new URL(req.url);
      const includeInactive =
        url.searchParams.get("includeInactive") === "true";

      const extras = await db.extra.findMany({
        where: {
          tenantId: session.tenantId!,
          ...(includeInactive ? {} : { isActive: true }),
        },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      });

      return ok(extras.map(toExtraDTO));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF", "PARTNER"]
);

// POST /api/extras — δημιουργία (μόνο διαχειριστής εταιρίας)
export const POST = withAuth(
  async (req, session) => {
    try {
      const body = await req.json();
      const parsed = createExtraSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      const extra = await db.extra.create({
        data: {
          tenantId: session.tenantId!,
          name: data.name.trim(),
          price: data.price,
          chargeType: data.chargeType,
          type: data.type,
          isActive: data.isActive,
        },
      });

      return created({ extra: toExtraDTO(extra) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN"]
);
