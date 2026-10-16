// src/lib/public/bookingSubmit.ts
// Δημόσια κράτηση — ΜΟΝΟ server. Η εταιρία ΜΟΝΟ από το slug
// (resolveStorefrontCompany)· η τιμή ΜΟΝΟ από την ίδια μηχανή (quote())·
// διαθεσιμότητα + εγγραφή ΜΕΣΑ σε pg_advisory_xact_lock της εταιρίας.

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { generateInvoiceCode } from "../invoiceCode";
import { nextBookingNumber } from "../bookingCreate";
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
import { loadSiteCatalog, type SiteCatalog } from "./site";
import { textFor } from "./text";

export type SubmitResult =
  | { ok: true; code: string; url: string }
  | { ok: false; status: 400 | 404 | 409 | 429; message: { el: string; en: string }; fieldErrors?: FieldError[]; ageUpdate?: number | null };

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
  lang: string
): BookingStore<Tx> {
  return {
    withLock: (key, fn) =>
      db.$transaction(
        async (tx) => {
          // Ένα κλείδωμα ανά εταιρία, ως το τέλος της transaction.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
          return fn(tx);
        },
        { timeout: 15_000, maxWait: 10_000 }
      ),
    loadBookings: (tx, window) => loadBlockingBookings(tx, cat.companyId, window),
    write: (tx, plan: SitePlan) =>
      writeSiteBooking(tx, { tenantId: cat.companyId, plan, contact, locations: locNames, window, lang }, {
        nextNumber: (t) => nextBookingNumber(t, cat.companyId),
        generateCode: generateInvoiceCode,
      }),
  };
}

/* ─────────────────────────────────────────────
   Υποβολή
   ───────────────────────────────────────────── */

export async function submitPublicBooking(body: unknown, now = new Date()): Promise<SubmitResult> {
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

  const contact = validateContact(input, { needsFlight: needsFlight(cat, c.pl, c.dl), pickupDate: c.from.slice(0, 10) });
  if (!contact.ok) {
    return { ok: false, status: 400, message: msg("Ελέγξτε τα στοιχεία της φόρμας.", "Please check the form."), fieldErrors: contact.errors };
  }

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
  if (!okEmail || !okTenant) {
    return { ok: false, status: 429, message: msg("Πολλές υποβολές. Δοκιμάστε ξανά σε λίγο ή επικοινωνήστε μαζί μας.", "Too many submissions. Please try again later or contact us.") };
  }

  const loc = (slug: string | null) => {
    const l = slug ? cat.ctx.locations.find((x) => x.slug === slug && x.isActive) : null;
    return l ? textFor(l.name, "el") || l.slug : null;
  };
  const result = await runSiteBooking(
    prismaStore(cat, contact.contact, { pickup: loc(c.pl), dropoff: loc(c.dl) }, { from: c.from, to: c.to }, input.lang),
    cat,
    { key: input.key, criteria: c, extras: input.extras, insuranceId: input.insuranceId, driverAge: band.age },
    now
  );
  if (!result.ok) {
    const status = result.error.code === "UNAVAILABLE" ? 409 : result.error.code === "NOT_FOUND" ? 404 : 400;
    return { ok: false, status, message: result.error.message };
  }
  return {
    ok: true,
    code: result.code,
    url: storefrontPath(resolved.company.slug, input.lang, "") + `/booking/${result.code}`,
  };
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
