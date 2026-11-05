export const dynamic = "force-dynamic";
// src/app/api/partner-commissions/pdf/route.ts
// GET /api/partner-commissions/pdf?[partner=<id>]&(month=YYYY-MM | from=&to=)
// → PDF «Αναφορά προμηθειών συνεργατών» (λήψη). Παράγεται ΣΤΟΝ SERVER από τα
// ΙΔΙΑ δεδομένα με την οθόνη (loadPartnerCommissions / loadPartnerCommissionDetail).
//
// Πρόσβαση ακριβώς όπως η σελίδα: Διαχειριστής πάντα, προσωπικό μόνο με
// «commission.partners», συνεργάτης ποτέ. Εταιρία ΜΟΝΟ από το session·
// συνεργάτης άλλης εταιρίας → 404. Όριο 20 PDF/ώρα ανά χρήστη. Λογότυπο από
// το ιδιωτικό Storage της εταιρίας (fetchLogoBytes: μόνο το logoPath της, με
// timeout και όριο μεγέθους· αποτυχία → χωρίς λογότυπο). Γλώσσα: του χρήστη.

import { NextResponse } from "next/server";
import { badRequest, forbidden, logError, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { normalizeLocale } from "@/lib/i18n/locale";
import { fetchLogoBytes } from "@/lib/invoiceServer";
import { buildCommissionsPdf, commissionsPdfFilename } from "@/lib/partnerCommissionsPdf";
import { loadPartnerCommissionDetail, loadPartnerCommissions, periodFromSearch } from "@/lib/partnerServer";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";

const TOO_MANY = { el: "Πολλές εκτυπώσεις σε λίγο χρόνο. Δοκιμάστε ξανά αργότερα.", en: "Too many PDFs in a short time. Please try again later." };

export const GET = withPermission(
  async (req, session, _params, viewer) => {
    try {
      if (!viewer?.tenantId || viewer.role === "PARTNER" || viewer.role === "SUPER_ADMIN") return forbidden();
      const sp = new URL(req.url).searchParams;
      // Η γλώσσα του χρήστη ΤΩΡΑ (από τη βάση — ό,τι δείχνει το dashboard).
      const me = await db.user.findUnique({ where: { id: viewer.userId }, select: { locale: true } });
      const lang = normalizeLocale(me?.locale ?? session.locale);

      const p = periodFromSearch(sp, lang);
      if (!p.ok) return badRequest(p.message);
      const partnerId = sp.get("partner") || null;

      if (!(await hitLimit(dbCounterStore, LIMITS.commissionsPdfPerUser, viewer.userId))) {
        return NextResponse.json({ success: false, message: TOO_MANY[lang] }, { status: 429 });
      }

      const [tenant, overview, detail] = await Promise.all([
        db.tenant.findUnique({ where: { id: viewer.tenantId }, select: { name: true, brandColor: true, logoPath: true } }),
        partnerId ? null : loadPartnerCommissions(viewer.tenantId, p.period),
        partnerId ? loadPartnerCommissionDetail(viewer.tenantId, partnerId, p.period) : null,
      ]);
      if (!tenant) return notFound();
      if (partnerId && !detail) return notFound("Ο συνεργάτης δεν βρέθηκε");

      const partners = detail ? [{ ...detail.partner, ...detail.totals }] : overview!.partners;
      const totals = detail ? detail.totals : overview!.totals;
      const pdf = await buildCommissionsPdf({
        lang,
        company: { name: tenant.name, brandColor: tenant.brandColor },
        logo: await fetchLogoBytes(tenant.logoPath),
        period: p.period,
        issuedAt: new Date(),
        partners,
        totals,
        bookings: detail ? detail.items : null,
      });

      const filename = commissionsPdfFilename(p.period, detail?.partner.name);
      return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(pdf.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      logError("partner-commissions/pdf", error);
      return serverError();
    }
  },
  "commission.partners"
);
