// src/lib/public/quoteServer.ts
// computeQuoteForTenant — η ΜΙΑ server συνάρτηση τιμής. ΜΟΝΟ server.
//
// Φορτώνει τις ρυθμίσεις της εταιρίας (loadQuoteContext: ίδιοι πίνακες για
// dashboard και site) και καλεί την quoteFromContext → quote(). Την καλούν:
// κράτηση/συμβόλαιο (bookingPricing.ts), «Δοκιμαστικός υπολογισμός»
// (/api/public-site/quote) και — με τον ίδιο κατάλογο ανά αίτημα — το site.
// Το tenantId: από τη ΣΥΝΕΔΡΙΑ στο dashboard, από το resolveStorefrontCompany στο site.

import { loadQuoteContext, type QuoteContext } from "./server";
import { quoteFromContext, type EngineOutcome, type QuoteRequest } from "./engine";

export async function computeQuoteForTenant(
  tenantId: string,
  request: QuoteRequest | ((ctx: QuoteContext) => QuoteRequest)
): Promise<(EngineOutcome & { ctx: QuoteContext }) | { ok: false; reason: "not_found"; ctx: null }> {
  const ctx = await loadQuoteContext(tenantId);
  if (!ctx) return { ok: false, reason: "not_found", ctx: null };
  const req = typeof request === "function" ? request(ctx) : request;
  return { ...quoteFromContext(ctx, req), ctx };
}
