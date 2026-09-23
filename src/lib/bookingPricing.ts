// src/lib/bookingPricing.ts
// Ο υπολογισμός τιμής ΣΤΟΝ SERVER.
//
// Ο client στέλνει ΜΟΝΟ ids και επιλογές (όχημα, πρόσθετα, τρόπο έκπτωσης).
// Κάθε ευρώ ξαναβγαίνει εδώ από τη βάση: η ημερήσια τιμή του οχήματος, οι
// τιμές των πρόσθετων, η αξία του κωδικού. Ό,τι ποσό κι αν έρθει από τη
// φόρμα αγνοείται — η φόρμα κάνει μόνο προεπισκόπηση.
//
// Όλα φιλτράρονται με tenantId: πρόσθετο ή κωδικός άλλης εταιρίας δεν
// εφαρμόζεται ποτέ.

import { db } from "./db";
import { resolveDiscountCode } from "./discounts";
import {
  computePrice,
  buildExtrasSnapshot,
  type DiscountMode,
  type ExtrasSnapshot,
  type PriceBreakdown,
} from "./pricing";

export interface PricingRequest {
  tenantId: string;
  vehicleId: string;
  /** Χρειάζεται για κωδικούς δεμένους σε συγκεκριμένο πελάτη. */
  customerId: string;
  totalDays: number;
  extraIds: string[];
  discountMode: DiscountMode;
  discountValue?: number;
  discountCode?: string | null;
}

export type PricingOutcome =
  | {
      ok: true;
      breakdown: PriceBreakdown;
      snapshot: ExtrasSnapshot;
      /** Ο κωδικός που όντως εφαρμόστηκε, αλλιώς null. */
      discountCode: string | null;
      dailyRate: number;
    }
  | { ok: false; message: string };

export async function priceBooking(
  req: PricingRequest
): Promise<PricingOutcome> {
  // Η ρύθμιση στρογγυλοποίησης διαβάζεται από τη βάση, ποτέ από το request:
  // ο client δεν μπορεί να την ανάψει ή να τη σβήσει για μία κράτηση.
  const [vehicle, tenant] = await Promise.all([
    db.vehicle.findFirst({
      where: { id: req.vehicleId, tenantId: req.tenantId },
      select: { id: true, dailyRate: true },
    }),
    db.tenant.findUnique({
      where: { id: req.tenantId },
      select: { roundUpTotal: true },
    }),
  ]);
  if (!vehicle) return { ok: false, message: "Το όχημα δεν βρέθηκε" };

  const roundUpTotal = tenant?.roundUpTotal ?? false;

  // Μοναδικά ids, ώστε να μη χρεωθεί δύο φορές το ίδιο πρόσθετο.
  const wanted = Array.from(new Set(req.extraIds));

  const extras = wanted.length
    ? await db.extra.findMany({
        where: { id: { in: wanted }, tenantId: req.tenantId, isActive: true },
        select: {
          id: true,
          name: true,
          price: true,
          chargeType: true,
          type: true,
        },
      })
    : [];

  // Αν κάποιο id δεν βρέθηκε, ανήκει σε άλλη εταιρία ή έχει
  // απενεργοποιηθεί — δεν σιωπούμε, απορρίπτουμε.
  if (extras.length !== wanted.length) {
    return {
      ok: false,
      message: "Κάποιο πρόσθετο δεν είναι διαθέσιμο πλέον",
    };
  }

  const pricedExtras = extras.map((e) => ({
    id: e.id,
    name: e.name,
    price: Number(e.price),
    chargeType: e.chargeType as string,
    type: e.type as string,
  }));

  // Πρώτο πέρασμα χωρίς έκπτωση, για να ξέρουμε τη βάση στην οποία
  // εφαρμόζεται ο κωδικός.
  const base = computePrice({
    totalDays: req.totalDays,
    dailyRate: Number(vehicle.dailyRate),
    extras: pricedExtras,
    discountMode: "NONE",
  });

  let codeDiscountAmount = 0;
  let appliedCode: string | null = null;

  if (req.discountMode === "CODE") {
    const code = (req.discountCode ?? "").trim();
    if (!code) return { ok: false, message: "Δώσε κωδικό έκπτωσης" };

    const resolved = await resolveDiscountCode({
      tenantId: req.tenantId,
      code,
      baseAmount: base.beforeDiscount,
      totalDays: req.totalDays,
      customerId: req.customerId,
    });

    if (!resolved.ok) return { ok: false, message: resolved.message };

    codeDiscountAmount = resolved.discount.amount;
    appliedCode = resolved.discount.code;
  }

  const breakdown = computePrice({
    totalDays: req.totalDays,
    dailyRate: Number(vehicle.dailyRate),
    extras: pricedExtras,
    discountMode: req.discountMode,
    discountValue: req.discountValue,
    codeDiscountAmount,
    roundUpTotal,
  });

  return {
    ok: true,
    breakdown,
    snapshot: buildExtrasSnapshot(breakdown.lines),
    discountCode: appliedCode,
    dailyRate: Number(vehicle.dailyRate),
  };
}
