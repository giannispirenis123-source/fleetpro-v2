export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/card-number/route.ts
// «Εμφάνιση» πλήρους αριθμού κάρτας — ΜΟΝΟ Διαχειριστής εταιρίας (COMPANY_ADMIN).
//
// GET ?kind=payment|deposit → { number } (ψηφία). Αποκρυπτογράφηση μόνο εδώ,
// στον server· ποτέ σε logs, Α4, σελίδα πελάτη ή searchText. no-store.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest, forbidden, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { ADMIN_ROLE } from "@/lib/adminRole";
import { contractScope } from "@/lib/contractForm";
import { CardKeyError, decryptCardNumber, readCardNumbersEnc } from "@/lib/cardCrypto";
import { CARD_KINDS, type CardKind } from "@/lib/cardNumber";

export const GET = withPermission(
  async (req, _session, params, viewer) => {
    if (viewer!.role !== ADMIN_ROLE) {
      return forbidden("Ο πλήρης αριθμός κάρτας εμφανίζεται μόνο σε Διαχειριστή");
    }
    const kind = new URL(req.url).searchParams.get("kind") as CardKind | null;
    if (!kind || !CARD_KINDS.includes(kind)) return badRequest("Μη έγκυρη κάρτα");

    try {
      const c = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        select: { cardNumberEnc: true },
      });
      if (!c) return notFound("Το συμβόλαιο δεν βρέθηκε");
      const token = readCardNumbersEnc(c.cardNumberEnc)[kind];
      if (!token) return notFound("Δεν υπάρχει αποθηκευμένος πλήρης αριθμός");

      return NextResponse.json(
        { success: true, data: { number: decryptCardNumber(token) } },
        { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }
      );
    } catch (error) {
      if (error instanceof CardKeyError) return serverError(error.message);
      // ΠΟΤΕ το ίδιο το σφάλμα/αριθμός στο log — μόνο το είδος του.
      console.error("card-number: αποτυχία αποκρυπτογράφησης", error instanceof Error ? error.name : "");
      return serverError("Ο αριθμός κάρτας δεν μπορεί να αποκρυπτογραφηθεί (άλλαξε το κλειδί;)");
    }
  },
  "contracts.view"
);
