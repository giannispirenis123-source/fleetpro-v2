export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/email/route.ts
// «Αποστολή στον πελάτη»: email (Resend) στον κύριο οδηγό με το link πελάτη
// και συνημμένο PDF. ΜΟΝΟ Διαχειριστής και Προσωπικό (όχι συνεργάτης).
//
// POST { lang: "el" | "en" } → { sentAt, sentTo, lang }
// Η λογική ζει στο src/lib/contractEmailSend.ts (ελέγχεται από τα tests)·
// εδώ συνδέονται βάση, Resend και PDF. Όλες οι εγγραφές με raw SQL: δεν
// αλλάζει το "updatedAt" (η ανοιχτή φόρμα δεν πρέπει να «χαλάσει»).

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { db } from "@/lib/db";
import { badRequest, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { CONTRACT_INCLUDE, contractScope, toContractDTO } from "@/lib/contractForm";
import { requestBaseUrl } from "@/lib/contractQr";
import { buildContractPdf } from "@/lib/contractPdf";
import {
  EMAIL_LANGS,
  EMAIL_SEND_LIMIT,
  EMAIL_SEND_WINDOW_MS,
  nextAllowedAt,
  readSendLog,
} from "@/lib/contractEmail";
import { sendContractEmail, type EmailSendDeps } from "@/lib/contractEmailSend";

const schema = z.object({ lang: z.enum(EMAIL_LANGS) });

/** Μόνο ο κωδικός του σφάλματος (π.χ. "validation_error") — ποτέ το μήνυμα. */
const errorCode = (e: unknown) => {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  return /^[a-z_]{1,40}$/i.test(name) ? name : "send_failed";
};

// POST /api/contracts/[id]/email
export const POST = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρη γλώσσα email");
      const id = params!.id;

      const deps: EmailSendDeps = {
        apiKey: process.env.RESEND_API_KEY,
        from: process.env.EMAIL_FROM,
        loadContract: async () => {
          const c = await db.contract.findFirst({
            where: { ...contractScope(viewer!), id },
            include: CONTRACT_INCLUDE,
          });
          if (!c) return null;
          const tenant = await db.tenant.findUnique({ where: { id: c.tenantId }, select: { vatRate: true } });
          const contract = toContractDTO(c);
          return { contract, link: contract.publicLink, vatRate: Number(tenant?.vatRate ?? 24) };
        },
        // Ατομικό: ο έλεγχος του ορίου και η προσθήκη στο ίδιο UPDATE (το
        // Postgres ξαναελέγχει το WHERE μετά το κλείδωμα της γραμμής).
        reserveAttempt: async (entry) => {
          const since = new Date(Date.parse(entry.at) - EMAIL_SEND_WINDOW_MS);
          const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
            UPDATE "contracts"
            SET "emailSendLog" = "emailSendLog" || jsonb_build_array(${JSON.stringify(entry)}::jsonb)
            WHERE "id" = ${id}
              AND (SELECT count(*) FROM jsonb_array_elements("emailSendLog") e
                   WHERE (e->>'at')::timestamptz > ${since.toISOString()}::timestamptz) < ${EMAIL_SEND_LIMIT}
            RETURNING "id"
          `);
          if (rows.length > 0) return { ok: true, entry };
          const c = await db.contract.findUnique({ where: { id }, select: { emailSendLog: true } });
          const log = readSendLog(c?.emailSendLog);
          const now = new Date(entry.at);
          return {
            ok: false,
            recent: log.filter((e) => Date.parse(e.at) > since.getTime()).length,
            retryAt: nextAllowedAt(log, now),
          };
        },
        finishAttempt: async (entryId, o) => {
          const patch = JSON.stringify(o.ok ? { ok: true } : { ok: false, error: o.error ?? "send_failed" });
          const log = Prisma.sql`COALESCE((
            SELECT jsonb_agg(CASE WHEN e->>'id' = ${entryId} THEN e || ${patch}::jsonb ELSE e END ORDER BY n)
            FROM jsonb_array_elements("emailSendLog") WITH ORDINALITY AS t(e, n)
          ), '[]'::jsonb)`;
          if (o.ok) {
            await db.$executeRaw(Prisma.sql`
              UPDATE "contracts"
              SET "emailSendLog" = ${log}, "emailSentAt" = (${o.at.toISOString()}::timestamptz AT TIME ZONE 'UTC'), "emailSentTo" = ${o.sentTo ?? null}
              WHERE "id" = ${id}
            `);
          } else {
            await db.$executeRaw(Prisma.sql`
              UPDATE "contracts" SET "emailSendLog" = ${log} WHERE "id" = ${id}
            `);
          }
        },
        buildPdf: (contract, url, vatRate) => buildContractPdf({ contract, url, fallbackVatRate: vatRate }),
        send: async (apiKey, email) => {
          try {
            const { error } = await new Resend(apiKey).emails.send(email);
            return { error: error ? errorCode(error) : null };
          } catch (e) {
            return { error: errorCode(e) };
          }
        },
        now: () => new Date(),
        newId: () => randomUUID(),
      };

      const result = await sendContractEmail(
        { role: viewer!.role, userId: viewer!.userId, origin: requestBaseUrl(), lang: parsed.data.lang },
        deps
      );
      if (result.status === 200) {
        return NextResponse.json({ success: true, data: result.data }, { headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json(
        { success: false, message: result.message, ...(result.retryAt ? { retryAt: result.retryAt } : {}) },
        { status: result.status }
      );
    } catch (error) {
      // Μόνο το είδος του σφάλματος: τίποτα από πελάτη/κάρτα στα logs.
      console.error("[FleetPro] email συμβολαίου: σφάλμα", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "contracts.view"
);
