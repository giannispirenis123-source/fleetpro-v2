// src/lib/public/bookingSubmit.ts
// Δημόσια κράτηση — ΜΟΝΟ server. Η εταιρία ΜΟΝΟ από το slug
// (resolveStorefrontCompany)· η τιμή ΜΟΝΟ από την ίδια μηχανή (quote())·
// διαθεσιμότητα + εγγραφή ΜΕΣΑ σε pg_advisory_xact_lock της εταιρίας.

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { generateInvoiceCode } from "../invoiceCode";
import { nextBookingNumber } from "../bookingCreate";
import { withBookingNumberRetry } from "../bookingNumberRetry";
import { resolveStorefrontCompany } from "../storefront/resolve";
import { storefrontPath } from "../storefront/slug";
import { loadBlockingBookings } from "./availability";
import {
  checkAgeBand,
  isBot,
  publicBookingSchema,
  validateContact,
  type CleanContact,
  type FieldError,
  type PublicBookingInput,
} from "./bookingRequest";
import { runSiteBooking, type BookingStore, type SitePlan } from "./bookingPlan";
import { writeSiteBooking } from "./bookingWrite";
import { INSURANCE_INVALID_MESSAGE, quoteFromContext, requestFromCriteria, hasUnpricedDay } from "./engine";
import type { QuoteResult } from "./pricing";
import { hitLimit, LIMITS } from "./rateLimit";
import { dbCounterStore } from "./rateLimitStore";
import { createBookingCheckout, expireStaleHolds, holdUntil, loadSitePayment } from "./paymentServer";
import { resolvePaymentMethod, type PaymentMethod } from "./payments";
import { loadSiteCatalog, type SiteCatalog } from "./site";
import { textFor } from "./text";

export type SubmitResult =
  | { ok: true; code: string; url: string }
  | { ok: false; status: 400 | 404 | 409 | 429 | 502; message: { el: string; en: string }; fieldErrors?: FieldError[]; ageUpdate?: number | null };

const msg = (el: string, en: string) => ({ el, en });

/** Χρειάζεται πτήση; Όταν το σημείο παραλαβής ή επιστροφής το ζητά (ή είναι αεροδρόμιο). */
export function needsFlight(cat: SiteCatalog, pl: string | null, dl: string | null): boolean {
  const loc = (slug: string | null) => (slug ? cat.ctx.locations.find((l) => l.slug === slug && l.isActive) : undefined);
  return !!(loc(pl)?.needsFlight || loc(dl ?? pl)?.needsFlight);
}

/* ─────────────────────────────────────────────
   Η εγγραφή στη βάση
   ───────────────────────────────────────────── */

type Tx = Prisma.TransactionClient;

function prismaStore(
  cat: SiteCatalog,
  contact: CleanContact,
  locNames: { pickup: string | null; dropoff: string | null },
  window: { from: string; to: string },
  lang: string,
  payment: { method: PaymentMethod; expiresAt: Date | null }
): BookingStore<Tx> {
  return {
    withLock: (key, fn) =>
      db.$transaction(
        async (tx) => {
          // Ένα κλείδωμα ανά εταιρία, ως το τέλος της transaction.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
          // Αναμονές πληρωμής που έληξαν χωρίς webhook → ακυρωμένες (καθαρή εικόνα στο dashboard).
          await expireStaleHolds(tx, cat.companyId);
          return fn(tx);
        },
        { timeout: 15_000, maxWait: 10_000 }
      ),
    loadBookings: (tx, window) => loadBlockingBookings(tx, cat.companyId, window),
    write: (tx, plan: SitePlan) =>
      writeSiteBooking(tx, { tenantId: cat.companyId, plan, contact, locations: locNames, window, lang, payment }, {
        nextNumber: (t) => nextBookingNumber(t, cat.companyId),
        generateCode: generateInvoiceCode,
      }),
  };
}

/* ─────────────────────────────────────────────
   Υποβολή
   ───────────────────────────────────────────── */

/**
 * `origin` = το deployment που εξυπηρετεί το site (για τα success/cancel URL
 * του Stripe). Με online πληρωμή το `url` είναι η σελίδα πληρωμής του Stripe.
 */
export async function submitPublicBooking(body: unknown, now = new Date(), origin = ""): Promise<SubmitResult> {
  const parsed = publicBookingSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, message: msg("Μη έγκυρα στοιχεία.", "Invalid data.") };
  const input: PublicBookingInput = parsed.data;

  // Honeypot: απάντηση χωρίς λεπτομέρειες, καμία εγγραφή.
  if (isBot(input)) return { ok: false, status: 400, message: msg("Δεν ήταν δυνατή η υποβολή.", "Submission failed.") };

  const resolved = await resolveStorefrontCompany(input.slug);
  if (!resolved) return { ok: false, status: 404, message: msg("Η σελίδα δεν βρέθηκε.", "Page not found.") };
  const cat = await loadSiteCatalog(resolved.companyId);
  if (!cat) return { ok: false, status: 404, message: msg("Η σελίδα δεν βρέθηκε.", "Page not found.") };
  const c = input.criteria;

  // Τρόπος πληρωμής: ΜΟΝΟ όσοι ισχύουν (online με ενεργό λογαριασμό + κλειδιά).
  const pay = await loadSitePayment(resolved.companyId);
  const method = resolvePaymentMethod(input.paymentMethod, pay?.options ?? "PICKUP_ONLY");
  const contact = validateContact(input, { needsFlight: needsFlight(cat, c.pl, c.dl), pickupDate: c.from.slice(0, 10) });
  if (!contact.ok || !method.ok) {
    return {
      ok: false,
      status: 400,
      message: msg("Ελέγξτε τα στοιχεία της φόρμας.", "Please check the form."),
      fieldErrors: [...(contact.ok ? [] : contact.errors), ...(method.ok ? [] : [{ field: "paymentMethod", message: method.message }])],
    };
  }
  const online = method.method === "ONLINE" && !!origin;

  // Η ημερομηνία γέννησης στην ΙΔΙΑ κλίμακα με την αναζήτηση (αλλιώς λάθος τιμή).
  const band = checkAgeBand(contact.contact.birthDate, c.from.slice(0, 10), c.age, cat.rules.ageBands);
  if (!band.ok) {
    return {
      ok: false,
      status: 409,
      message: band.allowed
        ? msg("Η ηλικία σας ανήκει σε άλλη κλίμακα τιμής. Ενημερώστε την τιμή.", "Your age falls in a different price band. Please update the price.")
        : msg("Δεν μπορούμε να εξυπηρετήσουμε οδηγό αυτής της ηλικίας.", "We cannot rent to a driver of this age."),
      fieldErrors: [{ field: "birthDate", message: msg("Δεν ταιριάζει με την ηλικία της αναζήτησης.", "Does not match the age in your search.") }],
      ageUpdate: band.allowed ? band.actualAge : null,
    };
  }

  // Όρια κατάχρησης (στη βάση, με hash κλειδιά).
  const okEmail = await hitLimit(dbCounterStore, LIMITS.bookingPerEmail, `${resolved.companyId}|${contact.contact.email}`, now);
  const okTenant = await hitLimit(dbCounterStore, LIMITS.bookingPerTenant, resolved.companyId, now);
  const okCheckout = !online || (await hitLimit(dbCounterStore, LIMITS.checkoutPerTenant, resolved.companyId, now));
  if (!okEmail || !okTenant || !okCheckout) {
    return { ok: false, status: 429, message: msg("Πολλές υποβολές. Δοκιμάστε ξανά σε λίγο ή επικοινωνήστε μαζί μας.", "Too many submissions. Please try again later or contact us.") };
  }

  const loc = (slug: string | null) => {
    const l = slug ? cat.ctx.locations.find((x) => x.slug === slug && x.isActive) : null;
    return l ? textFor(l.name, "el") || l.slug : null;
  };
  // Σύγκρουση στο UNIQUE αριθμού κράτησης → ξανά ολόκληρο (κλείδωμα, διαθεσιμότητα, εγγραφή).
  const result = await withBookingNumberRetry(() => runSiteBooking(
    prismaStore(cat, contact.contact, { pickup: loc(c.pl), dropoff: loc(c.dl) }, { from: c.from, to: c.to }, input.lang, {
      method: online ? "ONLINE" : "PICKUP",
      expiresAt: online ? holdUntil(now) : null,
    }),
    cat,
    { key: input.key, criteria: c, extras: input.extras, insuranceId: input.insuranceId, driverAge: band.age },
    now
  ));
  if (!result.ok) {
    const status = result.error.code === "UNAVAILABLE" ? 409 : result.error.code === "NOT_FOUND" ? 404 : 400;
    return { ok: false, status, message: result.error.message };
  }
  const bookingUrl = storefrontPath(resolved.company.slug, input.lang, "") + `/booking/${result.code}`;
  if (!online) return { ok: true, code: result.code, url: bookingUrl };

  // Online: η κράτηση γράφτηκε (AWAITING_PAYMENT)· τώρα η σελίδα πληρωμής του Stripe.
  const checkout = await createBookingCheckout({ companyId: resolved.companyId, code: result.code, origin, lang: input.lang });
  if (!checkout.ok) {
    return {
      ok: false,
      status: 502,
      message: msg(
        "Η online πληρωμή δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά ή διαλέξτε πληρωμή στην παραλαβή.",
        "Online payment is not available right now. Please try again or choose to pay on pick-up."
      ),
    };
  }
  return { ok: true, code: result.code, url: checkout.url };
}

/* ─────────────────────────────────────────────
   Τιμή της φόρμας (extras/ασφάλεια) — ίδια μηχανή, χωρίς εγγραφή
   ───────────────────────────────────────────── */

export type FormQuote = { ok: true; quote: QuoteResult } | { ok: false; status: 400 | 404; message: { el: string; en: string } | null };

export function publicFormQuote(
  cat: SiteCatalog,
  key: string,
  criteria: { pl: string | null; dl: string | null; from: string; to: string; age: number | null },
  extras: { id: string; qty: number }[],
  insuranceId: string | null | undefined,
  now = new Date()
): FormQuote {
  const notFound: FormQuote = { ok: false, status: 404, message: null };
  if (key.startsWith("v.") && !cat.vehicles.some((v) => v.id === key.slice(2) && !v.rentalGroupId)) return notFound;
  const base = requestFromCriteria(cat.ctx, cat.groups, key, criteria, now);
  if (!base) return notFound;
  const out = quoteFromContext(cat.ctx, { ...base, extras, insuranceId });
  if (!out.ok) return out.reason === "insurance" ? { ok: false, status: 400, message: INSURANCE_INVALID_MESSAGE } : notFound;
  if (hasUnpricedDay(out.result)) return notFound;
  return { ok: true, quote: out.result };
}
