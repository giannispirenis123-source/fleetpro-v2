export const dynamic = "force-dynamic";
// src/app/api/bookings/[id]/messages/route.ts
// Καταγραφή χειροκίνητης αποστολής (WhatsApp / mailto): ο χρήστης πάτησε το
// κουμπί και άνοιξε η εφαρμογή του. Δεν ξέρουμε αν τελικά πάτησε «Αποστολή»,
// γι' αυτό το αποτέλεσμα είναι «opened». Κανένα προσωπικό στοιχείο.

import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, forbidden, notFound, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { canDecide } from "@/lib/bookingDecision";
import { MESSAGE_KINDS, messageLang } from "@/lib/bookingMessages";
import { normalizeStorefrontSettings } from "@/lib/storefront/settings";
import { storedTotalCents } from "@/lib/public/money";

const schema = z.object({ kind: z.enum(MESSAGE_KINDS), channel: z.enum(["whatsapp", "mailto"]) });

export const POST = withPermission(
  async (req, session, params, viewer) => {
    try {
      const v = viewer!;
      if (!canDecide(v.role, v.permissions, "confirm") && !canDecide(v.role, v.permissions, "cancel")) {
        return forbidden("Δεν έχετε δικαίωμα για αυτή την ενέργεια");
      }
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα");
      const tenantId = session.tenantId!;
      const b = await db.booking.findFirst({
        where: { id: params!.id, tenantId },
        select: { id: true, siteLang: true, priceQuote: true, total: true, tenant: { select: { storefrontSettings: true } } },
      });
      if (!b) return notFound("Η κράτηση δεν βρέθηκε");
      await db.bookingNotification.create({
        data: {
          tenantId,
          bookingId: b.id,
          userId: v.userId,
          kind: parsed.data.kind,
          channel: parsed.data.channel,
          result: "opened",
          // Το σύνολο του μηνύματος: από το ΑΠΟΘΗΚΕΥΜΕΝΟ priceQuote (όπως και στο κείμενο).
          amountCents: storedTotalCents(b.priceQuote, b.total),
          lang: messageLang(b.siteLang, normalizeStorefrontSettings(b.tenant.storefrontSettings).defaultLanguage),
        },
      });
      return ok({ recorded: true });
    } catch (error) {
      console.error("[FleetPro] booking message log", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "bookings.view"
);
