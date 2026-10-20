// src/lib/bookingDecisionServer.ts
// Η σύνδεση του bookingDecision.ts με τη βάση και το Resend — ΜΟΝΟ server.
// Η εταιρία ΠΑΝΤΑ από τη συνεδρία (tenantId)· κάθε ερώτημα φιλτράρει με αυτήν.

import { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { db } from "./db";
import { applyDiscountUsage } from "./discounts";
import { syncVehicleStatus } from "./bookingLifecycle";
import { classifyProviderError } from "./invoiceEmail";
import { lockKeyFor } from "./public/bookingPlan";
import { loadBlockingBookings } from "./public/availability";
import { nowLocal } from "./public/search";
import { similarModelName } from "./public/catalog";
import { readLocalized, textFor } from "./public/text";
import { normalizeStorefrontSettings } from "./storefront/settings";
import { storedInsurance } from "./pricingBridge";
import { storefrontPath } from "./storefront/slug";
import {
  buildBookingMessage,
  messageLang,
  type BookingMessage,
  type MessageData,
  type MessageKind,
} from "./bookingMessages";
import type { DecisionBooking, DecisionPatch, DecisionStore, MessageDeps } from "./bookingDecision";

type Tx = Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/* ─────────────────────────────────────────────
   Ιστορικό (activity_logs): ποιος, πότε, από τι σε τι
   ───────────────────────────────────────────── */

export async function logBookingStatus(
  client: Tx | typeof db,
  e: {
    tenantId: string;
    userId: string;
    bookingId: string;
    from: { status: string; vehicleId: string | null };
    to: { status: string; vehicleId: string | null; cancelReasonCode?: string | null };
  }
): Promise<void> {
  if (e.from.status === e.to.status && e.from.vehicleId === e.to.vehicleId) return;
  await client.activityLog.create({
    data: {
      tenantId: e.tenantId,
      userId: e.userId,
      action: `booking.${e.to.status.toLowerCase()}`,
      entity: "Booking",
      entityId: e.bookingId,
      oldData: e.from,
      newData: e.to,
    },
  });
}

/* ─────────────────────────────────────────────
   Η κράτηση μέσα στο κλείδωμα
   ───────────────────────────────────────────── */

export function prismaDecisionStore(tenantId: string, bookingId: string, userId: string): DecisionStore<Tx> & {
  previousDiscountCode(): string | null;
} {
  let discountCode: string | null = null;
  return {
    withLock: (fn) =>
      db.$transaction(
        async (tx) => {
          // Ίδιο κλείδωμα με τις υποβολές του site: καμία ταυτόχρονη ανάθεση του ίδιου οχήματος.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKeyFor(tenantId)}))`;
          return fn(tx);
        },
        { timeout: 15_000, maxWait: 10_000 }
      ),
    loadBooking: async (tx): Promise<DecisionBooking | null> => {
      const b = await tx.booking.findFirst({
        where: { id: bookingId, tenantId },
        select: {
          id: true,
          tenantId: true,
          status: true,
          vehicleId: true,
          rentalGroupId: true,
          pickupDate: true,
          pickupTime: true,
          returnDate: true,
          returnTime: true,
          discountCode: true,
        },
      });
      if (!b) return null;
      discountCode = b.discountCode;
      return {
        id: b.id,
        tenantId: b.tenantId,
        status: b.status,
        vehicleId: b.vehicleId,
        rentalGroupId: b.rentalGroupId,
        pickupDate: iso(b.pickupDate),
        pickupTime: b.pickupTime,
        returnDate: iso(b.returnDate),
        returnTime: b.returnTime,
      };
    },
    loadVehicles: (tx) =>
      tx.vehicle.findMany({
        where: { tenantId },
        select: { id: true, tenantId: true, rentalGroupId: true, status: true, isActive: true },
      }),
    loadBlocking: (tx, window) => loadBlockingBookings(tx, tenantId, window),
    prepMinutes: async (tx) =>
      (await tx.tenant.findUnique({ where: { id: tenantId }, select: { prepTimeMinutes: true } }))?.prepTimeMinutes ?? 0,
    nowLocal: () => nowLocal(),
    apply: async (tx, patch: DecisionPatch, prev) => {
      await tx.booking.update({
        where: { id: prev.id },
        data:
          patch.status === "CONFIRMED"
            ? { status: "CONFIRMED", vehicleId: patch.vehicleId }
            : { status: "CANCELLED", cancelReasonCode: patch.cancelReasonCode, cancelNote: patch.cancelNote },
      });
      const nextVehicle = patch.status === "CONFIRMED" ? patch.vehicleId : prev.vehicleId;
      if (patch.status === "CANCELLED") {
        // Η ακύρωση ελευθερώνει τη χρήση του κωδικού έκπτωσης (όπως το DELETE).
        await applyDiscountUsage({ tenantId, previousCode: discountCode, nextCode: null }, tx);
      }
      if (nextVehicle) await syncVehicleStatus(nextVehicle, tenantId, tx);
      if (prev.vehicleId && prev.vehicleId !== nextVehicle) await syncVehicleStatus(prev.vehicleId, tenantId, tx);
      await logBookingStatus(tx, {
        tenantId,
        userId,
        bookingId: prev.id,
        from: { status: prev.status, vehicleId: prev.vehicleId },
        to: {
          status: patch.status,
          vehicleId: nextVehicle,
          ...(patch.status === "CANCELLED" ? { cancelReasonCode: patch.cancelReasonCode } : {}),
        },
      });
    },
    previousDiscountCode: () => discountCode,
  };
}

/* ─────────────────────────────────────────────
   Τα στοιχεία του μηνύματος (από τη βάση, ποτέ από τον browser)
   ───────────────────────────────────────────── */

export interface MessageContext {
  /** Για τα κείμενα: όλα στη γλώσσα του πελάτη. */
  data: Omit<MessageData, "kind" | "reasonCode" | "note">;
  status: string;
  reasonCode: string | null;
  note: string | null;
  /** ΜΟΝΟ για ρόλους που βλέπουν ήδη την κράτηση — ποτέ σε logs. */
  customerEmail: string | null;
  customerPhone: string | null;
  companyEmail: string | null;
  fromSite: boolean;
}

export async function loadMessageContext(tenantId: string, bookingId: string, origin: string): Promise<MessageContext | null> {
  const b = await db.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: {
      bookingNumber: true,
      publicCode: true,
      status: true,
      siteLang: true,
      source: true,
      pickupDate: true,
      pickupTime: true,
      returnDate: true,
      returnTime: true,
      pickupLocation: true,
      returnLocation: true,
      priceQuote: true,
      total: true,
      cancelReasonCode: true,
      cancelNote: true,
      paymentMethod: true,
      payments: { where: { purpose: "BOOKING", status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } }, select: { amountCents: true, refundedCents: true, retainedCents: true } },
      customer: { select: { firstName: true, email: true, phone: true } },
      rentalGroup: { select: { name: true, similarModels: true } },
      vehicle: { select: { brand: true, model: true, rentalGroup: { select: { name: true, similarModels: true } } } },
      tenant: { select: { name: true, phone: true, email: true, storefrontSlug: true, storefrontSettings: true } },
    },
  });
  if (!b) return null;

  const lang = messageLang(b.siteLang, normalizeStorefrontSettings(b.tenant.storefrontSettings).defaultLanguage);
  // Κράτηση του site: η ομάδα που διάλεξε («… ή παρόμοιο»). Αλλιώς το ίδιο το όχημα.
  const g = b.rentalGroup ?? (b.source === "site" ? b.vehicle.rentalGroup : null);
  const groupName = g ? textFor(readLocalized(g.name), lang) || `${b.vehicle.brand} ${b.vehicle.model}` : `${b.vehicle.brand} ${b.vehicle.model}`;
  const similar = g ? similarModelName(textFor(readLocalized(g.similarModels), lang)) : "";

  // Τα σημεία αποθηκεύονται με το ελληνικό τους όνομα → στη γλώσσα του πελάτη.
  const locations = await db.pickupLocation.findMany({ where: { tenantId }, select: { name: true } });
  const localize = (stored: string | null) => {
    if (!stored) return null;
    const hit = locations.find((l) => textFor(readLocalized(l.name), "el") === stored);
    return hit ? textFor(readLocalized(hit.name), lang) || stored : stored;
  };

  const q = (b.priceQuote && typeof b.priceQuote === "object" ? b.priceQuote : {}) as { totalCents?: unknown; version?: unknown };
  const totalCents = typeof q.totalCents === "number" ? q.totalCents : Math.round(Number(b.total) * 100);
  // Ασφάλεια από το ΑΠΟΘΗΚΕΥΜΕΝΟ priceQuote· παλιά κράτηση χωρίς ανάλυση → καμία γραμμή.
  const ins = storedInsurance(b.priceQuote);
  const insuranceName = q.version === 1 ? (ins ? textFor(ins.name, lang) || null : null) : undefined;

  const slug = b.tenant.storefrontSlug;
  const base = origin.replace(/\/+$/, "");
  return {
    data: {
      lang,
      code: b.publicCode ?? b.bookingNumber,
      firstName: b.customer.firstName,
      groupName,
      groupSimilar: similar || null,
      from: `${iso(b.pickupDate)}T${b.pickupTime ?? "10:00"}`,
      to: `${iso(b.returnDate)}T${b.returnTime ?? "10:00"}`,
      pickupLocation: localize(b.pickupLocation),
      returnLocation: localize(b.returnLocation),
      totalCents,
      insuranceName,
      company: { name: b.tenant.name, phone: b.tenant.phone || null, email: b.tenant.email || null },
      payment: b.payments.length
        ? {
            paidCents: b.payments.reduce((n, p) => n + p.amountCents, 0),
            refundedCents: b.payments.reduce((n, p) => n + p.refundedCents, 0),
            retainedCents: b.payments.reduce((n, p) => n + p.retainedCents, 0),
          }
        : null,
      paymentMethod: b.paymentMethod,
      bookingUrl: slug && b.publicCode ? `${base}${storefrontPath(slug, lang)}/booking/${b.publicCode}` : null,
      searchUrl: slug ? `${base}${storefrontPath(slug, lang)}` : null,
    },
    status: b.status,
    reasonCode: b.cancelReasonCode,
    note: b.cancelNote,
    customerEmail: b.customer.email || null,
    customerPhone: b.customer.phone || null,
    companyEmail: b.tenant.email || null,
    fromSite: b.source === "site",
  };
}

export function messageFromContext(ctx: MessageContext, kind: MessageKind): BookingMessage {
  return buildBookingMessage({ ...ctx.data, kind, reasonCode: ctx.reasonCode, note: ctx.note });
}

/** Οι εξαρτήσεις αποστολής με Resend + καταγραφή στο booking_notifications. */
export function prismaMessageDeps(tenantId: string, bookingId: string, userId: string, origin: string): MessageDeps {
  return {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    loadNotifications: () =>
      db.bookingNotification.findMany({ where: { tenantId, bookingId }, select: { kind: true, channel: true, result: true } }),
    buildMessage: async (kind) => {
      const ctx = await loadMessageContext(tenantId, bookingId, origin);
      if (!ctx) return null;
      return { message: messageFromContext(ctx, kind), to: ctx.customerEmail, replyTo: ctx.companyEmail };
    },
    send: async (apiKey, email) => {
      try {
        const { error } = await new Resend(apiKey).emails.send(email);
        return { error: error ? classifyProviderError(error) : null };
      } catch (e) {
        return { error: classifyProviderError(e) };
      }
    },
    record: async (row) => {
      await db.bookingNotification.create({ data: { tenantId, bookingId, userId, ...row } });
    },
  };
}

/** Το origin για τα links προς τον πελάτη (το ίδιο deployment που εξυπηρετεί το site). */
export function publicOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto.split(",")[0]}://${host.split(",")[0]}` : new URL(req.url).origin;
}
