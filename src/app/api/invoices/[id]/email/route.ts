export const dynamic = "force-dynamic";
// src/app/api/invoices/[id]/email/route.ts
// «Αποστολή στον πελάτη»: email (Resend) στον πελάτη του τιμολογίου με
// συνημμένο το (δίγλωσσο) PDF. Το lang αφορά ΜΟΝΟ θέμα και κείμενο του email. ΜΟΝΟ Διαχειριστής και Προσωπικό (όχι συνεργάτης).
//
// POST { lang: "el" | "en" } → { sentAt, sentTo, lang }
// Η λογική ζει στο src/lib/invoiceEmailSend.ts (ελέγχεται από τα tests)·
// εδώ συνδέονται βάση, Resend και PDF. Οι εγγραφές με raw SQL, όπως στο
// email του συμβολαίου (ατομικός έλεγχος ορίου 5/ώρα).

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { db } from "@/lib/db";
import { badRequest, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import {
  EMAIL_SEND_LIMIT,
  EMAIL_SEND_WINDOW_MS,
  nextAllowedAt,
  readSendLog,
} from "@/lib/contractEmail";
import { DOC_LANGS } from "@/lib/invoiceDocument";
import { classifyProviderError } from "@/lib/invoiceEmail";
import { sendInvoiceEmail, type InvoiceEmailDeps } from "@/lib/invoiceEmailSend";
import { fetchLogoBytes, loadInvoiceDoc } from "@/lib/invoiceServer";
import { buildInvoicePdf } from "@/lib/invoicePdf";
import { TIMEOUTS, withTimeout } from "@/lib/withTimeout";

const schema = z.object({ lang: z.enum(DOC_LANGS) });

// POST /api/invoices/[id]/email
export const POST = withPermission(
  async (req, session, params, viewer) => {
    try {
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρη γλώσσα email");
      const id = params!.id;
      // Η εταιρία ΜΟΝΟ από τη συνεδρία.
      const tenantId = session.tenantId ?? "";
      let logoPath: string | null = null;

      const deps: InvoiceEmailDeps = {
        apiKey: process.env.RESEND_API_KEY,
        from: process.env.EMAIL_FROM,
        loadInvoice: async () => {
          if (!tenantId) return null;
          const loaded = await loadInvoiceDoc(tenantId, id);
          if (!loaded) return null;
          logoPath = loaded.logoPath;
          return { doc: loaded.doc, customerEmail: loaded.customerEmail };
        },
        // Ατομικό: ο έλεγχος του ορίου και η προσθήκη στο ίδιο UPDATE.
        reserveAttempt: async (entry) => {
          const since = new Date(Date.parse(entry.at) - EMAIL_SEND_WINDOW_MS);
          const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
            UPDATE "invoices"
            SET "emailSendLog" = "emailSendLog" || jsonb_build_array(${JSON.stringify(entry)}::jsonb)
            WHERE "id" = ${id} AND "tenantId" = ${tenantId}
              AND (SELECT count(*) FROM jsonb_array_elements("emailSendLog") e
                   WHERE (e->>'at')::timestamptz > ${since.toISOString()}::timestamptz) < ${EMAIL_SEND_LIMIT}
            RETURNING "id"
          `);
          if (rows.length > 0) return { ok: true, entry };
          const row = await db.invoice.findFirst({ where: { id, tenantId }, select: { emailSendLog: true } });
          const log = readSendLog(row?.emailSendLog);
          return {
            ok: false,
            recent: log.filter((e) => Date.parse(e.at) > since.getTime()).length,
            retryAt: nextAllowedAt(log, new Date(entry.at)),
          };
        },
        finishAttempt: async (entryId, o) => {
          const patch = JSON.stringify(o.ok ? { ok: true } : { ok: false, error: o.error ?? "send_failed" });
          const log = Prisma.sql`COALESCE((
            SELECT jsonb_agg(CASE WHEN e->>'id' = ${entryId} THEN e || ${patch}::jsonb ELSE e END ORDER BY n)
            FROM jsonb_array_elements("emailSendLog") WITH ORDINALITY AS t(e, n)
          ), '[]'::jsonb)`;
          if (o.ok) {
            const at = Prisma.sql`(${o.at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
            await db.$executeRaw(Prisma.sql`
              UPDATE "invoices"
              SET "emailSendLog" = ${log}, "emailSentAt" = ${at}, "sentAt" = ${at}, "emailSentTo" = ${o.sentTo ?? null}
              WHERE "id" = ${id} AND "tenantId" = ${tenantId}
            `);
          } else {
            await db.$executeRaw(Prisma.sql`
              UPDATE "invoices" SET "emailSendLog" = ${log} WHERE "id" = ${id} AND "tenantId" = ${tenantId}
            `);
          }
        },
        // Το συνημμένο είναι το ίδιο δίγλωσσο PDF· η γλώσσα αφορά μόνο το email.
        buildPdf: async (doc) => buildInvoicePdf({ doc, logo: await fetchLogoBytes(logoPath) }),
        send: async (apiKey, email) => {
          try {
            const { error } = await withTimeout(new Resend(apiKey).emails.send(email), TIMEOUTS.email, "email");
            return { error: error ? classifyProviderError(error) : null };
          } catch (e) {
            return { error: classifyProviderError(e) };
          }
        },
        now: () => new Date(),
        newId: () => randomUUID(),
      };

      const result = await sendInvoiceEmail(
        { role: viewer!.role, userId: viewer!.userId, lang: parsed.data.lang },
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
      // Μόνο το είδος του σφάλματος: τίποτα από πελάτη/κλειδιά στα logs.
      console.error("[FleetPro] email τιμολογίου: σφάλμα", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "invoices.view"
);
