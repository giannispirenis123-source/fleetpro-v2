// src/lib/bookingDecision.ts
// «Επιβεβαίωση» και «Ακύρωση» μιας κράτησης από το dashboard — η ΛΟΓΙΚΗ,
// με ΕΓΧΥΟΜΕΝΕΣ εξαρτήσεις (βάση, Resend), ώστε να ελέγχεται χωρίς βάση.
// Το route (api/bookings/[id]/decision) συνδέει τις πραγματικές.
//
// Σειρά:
//   ρόλος/δικαίωμα (403 — ο συνεργάτης ΜΟΝΟ βλέπει) → κράτηση της εταιρίας
//   (404) → επιτρεπτή μετάβαση (400) → [επιβεβαίωση: ελεύθερο όχημα της
//   ομάδας, ΜΕΣΑ στο κλείδωμα της εταιρίας (409 αν δεν υπάρχει)] → εγγραφή
//   κατάστασης + ιστορικό → μήνυμα στον πελάτη.
//
// Το μήνυμα ΔΕΝ μπορεί να ακυρώσει την αλλαγή κατάστασης: αν το email
// αποτύχει, η κράτηση έχει ήδη επιβεβαιωθεί/ακυρωθεί και απλώς γράφεται
// «Δεν στάλθηκε». Διπλό email του ίδιου είδους δεν φεύγει ποτέ αυτόματα.

import { z } from "zod";
import { STATUS_TRANSITIONS } from "./bookings";
import { can, type PermissionKey, type PermissionMap } from "./permissions";
import { freeVehicleIds, type BlockingBooking, type FleetVehicle } from "./public/availability";
import { CANCEL_NOTE_MAX, CANCEL_REASONS, cleanNote, emailAlreadySent, type BookingMessage, type MessageKind } from "./bookingMessages";

export const decisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm"),
    vehicleId: z.string().min(1).max(64).optional(),
    notify: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("cancel"),
    reasonCode: z.enum(CANCEL_REASONS).nullable().optional(),
    note: z.string().max(CANCEL_NOTE_MAX * 2).nullable().optional(),
    notify: z.boolean().default(true),
  }),
]);
export type DecisionRequest = z.infer<typeof decisionSchema>;

/** Ποιο δικαίωμα χρειάζεται κάθε ενέργεια (ίδια κλειδιά με το PATCH/DELETE). */
export const DECISION_PERMISSION: Record<DecisionRequest["action"], PermissionKey> = {
  confirm: "bookings.status",
  cancel: "bookings.cancel",
};

/** Ο συνεργάτης ΜΟΝΟ βλέπει — ποτέ επιβεβαίωση/ακύρωση, όποια κι αν είναι τα δικαιώματά του. */
export function canDecide(role: string, permissions: PermissionMap | null | undefined, action: DecisionRequest["action"]): boolean {
  if (role === "PARTNER" || role === "SUPER_ADMIN") return false;
  return can(role, permissions, DECISION_PERMISSION[action]);
}

export const DECISION_MSG = {
  role: "Δεν έχετε δικαίωμα για αυτή την ενέργεια",
  notFound: "Η κράτηση δεν βρέθηκε",
  transition: (from: string, to: string) => `Μη επιτρεπτή μετάβαση: ${from} → ${to}`,
  noFreeVehicle: "Δεν υπάρχει ελεύθερο όχημα της ομάδας για αυτό το διάστημα. Η κράτηση δεν επιβεβαιώθηκε.",
  vehicleNotFree: "Το όχημα που διαλέξατε δεν είναι ελεύθερο για αυτό το διάστημα.",
} as const;

export interface DecisionBooking {
  id: string;
  tenantId: string;
  status: string;
  vehicleId: string | null;
  rentalGroupId: string | null;
  /** "YYYY-MM-DD" */
  pickupDate: string;
  pickupTime: string | null;
  returnDate: string;
  returnTime: string | null;
}

/** Οχήματα της εταιρίας, με την ομάδα τους (για την ανάθεση). */
export interface DecisionVehicle {
  id: string;
  tenantId: string;
  rentalGroupId: string | null;
  status: string;
  isActive: boolean;
}

/** Το διάστημα της κράτησης σε «ώρα τοίχου»· χωρίς ώρα = όλη η ημέρα. */
export const windowOfBooking = (b: Pick<DecisionBooking, "pickupDate" | "pickupTime" | "returnDate" | "returnTime">) => ({
  from: `${b.pickupDate}T${b.pickupTime ?? "00:00"}`,
  to: `${b.returnDate}T${b.returnTime ?? "23:59"}`,
});

/** Η «ομάδα» μέσα στην οποία γίνεται η ανάθεση: της κράτησης, αλλιώς του τρέχοντος οχήματος. */
function groupKeyOf(b: DecisionBooking, vehicles: DecisionVehicle[]): string | null {
  if (b.rentalGroupId) return `g:${b.rentalGroupId}`;
  const current = vehicles.find((v) => v.id === b.vehicleId);
  if (current?.rentalGroupId) return `g:${current.rentalGroupId}`;
  return b.vehicleId ? `v:${b.vehicleId}` : null;
}

/**
 * Τα ΕΛΕΥΘΕΡΑ οχήματα της ομάδας για το διάστημα της κράτησης — με τους
 * κανόνες του availability.ts (ίδιοι με τον έλεγχο σύγκρουσης του dashboard:
 * PENDING/CONFIRMED/ACTIVE κλείνουν, χρόνος προετοιμασίας, service/ανενεργό
 * εκτός). Η ίδια η κράτηση δεν «κλείνει» το δικό της όχημα.
 */
export function freeVehiclesFor(
  b: DecisionBooking,
  vehicles: DecisionVehicle[],
  blocking: BlockingBooking[],
  prepMinutes: number,
  nowLocal?: string
): string[] {
  const key = groupKeyOf(b, vehicles);
  if (!key) return [];
  const fleet: FleetVehicle[] = vehicles.map((v) => ({
    id: v.id,
    tenantId: v.tenantId,
    groupKey: v.rentalGroupId ? `g:${v.rentalGroupId}` : `v:${v.id}`,
    status: v.status,
    isActive: v.isActive,
  }));
  const w = windowOfBooking(b);
  return freeVehicleIds(
    {
      companyId: b.tenantId,
      vehicles: fleet,
      bookings: blocking.filter((x) => x.id !== b.id),
      from: w.from,
      to: w.to,
      prepMinutes,
      now: nowLocal,
    },
    key
  );
}

export type DecisionPatch =
  | { status: "CONFIRMED"; vehicleId: string }
  | { status: "CANCELLED"; cancelReasonCode: string | null; cancelNote: string | null };

export type PlanResult =
  | { ok: true; patch: DecisionPatch; kind: MessageKind }
  | { ok: false; status: 400 | 409; message: string; freeVehicleIds?: string[] };

/** Καθαρό: τι αλλάζει στην κράτηση. Καμία εγγραφή. */
export function planDecision(
  b: DecisionBooking,
  req: DecisionRequest,
  ctx: { vehicles: DecisionVehicle[]; blocking: BlockingBooking[]; prepMinutes: number; nowLocal?: string }
): PlanResult {
  const target = req.action === "confirm" ? "CONFIRMED" : "CANCELLED";
  if (!(STATUS_TRANSITIONS[b.status] ?? []).includes(target)) {
    return { ok: false, status: 400, message: DECISION_MSG.transition(b.status, target) };
  }

  if (req.action === "cancel") {
    return {
      ok: true,
      kind: "cancel",
      patch: { status: "CANCELLED", cancelReasonCode: req.reasonCode ?? null, cancelNote: cleanNote(req.note) },
    };
  }

  const free = freeVehiclesFor(b, ctx.vehicles, ctx.blocking, ctx.prepMinutes, ctx.nowLocal);
  if (req.vehicleId) {
    if (!free.includes(req.vehicleId)) {
      return free.length
        ? { ok: false, status: 409, message: DECISION_MSG.vehicleNotFree, freeVehicleIds: free }
        : { ok: false, status: 409, message: DECISION_MSG.noFreeVehicle, freeVehicleIds: [] };
    }
    return { ok: true, kind: "confirm", patch: { status: "CONFIRMED", vehicleId: req.vehicleId } };
  }
  // Χωρίς επιλογή: κρατά το τρέχον όχημα ΑΝ είναι ελεύθερο· αλλιώς ζητά επιλογή.
  if (b.vehicleId && free.includes(b.vehicleId)) {
    return { ok: true, kind: "confirm", patch: { status: "CONFIRMED", vehicleId: b.vehicleId } };
  }
  return free.length
    ? { ok: false, status: 409, message: DECISION_MSG.vehicleNotFree, freeVehicleIds: free }
    : { ok: false, status: 409, message: DECISION_MSG.noFreeVehicle, freeVehicleIds: [] };
}

/* ─────────────────────────────────────────────
   Εκτέλεση (η βάση δίνεται από τον καλούντα)
   ───────────────────────────────────────────── */

export type EmailOutcome =
  | "sent"
  | "failed"
  | "already_sent"
  | "no_email"
  | "not_configured"
  | "not_requested";

export interface NotificationRow {
  kind: string;
  channel: string;
  result: string;
}

export interface DecisionStore<Tx> {
  /** Transaction ΚΡΑΤΩΝΤΑΣ το κλείδωμα της εταιρίας (ίδιο με τις υποβολές του site). */
  withLock<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Η κράτηση ΤΗΣ ΕΤΑΙΡΙΑΣ του χρήστη, ή null. */
  loadBooking(tx: Tx): Promise<DecisionBooking | null>;
  loadVehicles(tx: Tx): Promise<DecisionVehicle[]>;
  loadBlocking(tx: Tx, window: { from: string; to: string }): Promise<BlockingBooking[]>;
  prepMinutes(tx: Tx): Promise<number>;
  nowLocal(): string | undefined;
  /** Νέα κατάσταση + ιστορικό (ποιος, πότε) — στην ίδια transaction. */
  apply(tx: Tx, patch: DecisionPatch, previous: DecisionBooking): Promise<void>;
}

export interface MessageDeps {
  apiKey: string | undefined;
  from: string | undefined;
  /** Προηγούμενες αποστολές της κράτησης (για να μη φύγει διπλό). */
  loadNotifications(): Promise<NotificationRow[]>;
  /** Το μήνυμα + το email του πελάτη (null αν δεν έχει). */
  buildMessage(kind: MessageKind): Promise<{ message: BookingMessage; to: string | null; replyTo: string | null } | null>;
  send(apiKey: string, email: { from: string; to: string; replyTo?: string; subject: string; text: string; html: string }): Promise<{ error: string | null }>;
  record(row: { kind: MessageKind; channel: "email"; result: "sent" | "failed"; error: string | null; lang: string | null }): Promise<void>;
}

export type DecisionResult =
  | { status: 200; data: { status: string; vehicleId: string | null; email: EmailOutcome; emailError: string | null } }
  | { status: 400 | 403 | 404 | 409; message: string; freeVehicleIds?: string[] };

/** Ποτέ παραλήπτης ή κλειδιά στα logs — μόνο κωδικοί. */
const log = (msg: string) => console.error(`[FleetPro] μήνυμα κράτησης: ${msg}`);

export async function decideBooking<Tx>(
  viewer: { role: string; permissions: PermissionMap | null | undefined },
  req: DecisionRequest,
  store: DecisionStore<Tx>,
  messages: MessageDeps
): Promise<DecisionResult> {
  if (!canDecide(viewer.role, viewer.permissions, req.action)) return { status: 403, message: DECISION_MSG.role };

  const outcome = await store.withLock(async (tx) => {
    const b = await store.loadBooking(tx);
    if (!b) return { ok: false as const, status: 404 as const, message: DECISION_MSG.notFound as string, freeVehicleIds: undefined };
    const vehicles = req.action === "confirm" ? await store.loadVehicles(tx) : [];
    const blocking = req.action === "confirm" ? await store.loadBlocking(tx, windowOfBooking(b)) : [];
    const prep = req.action === "confirm" ? await store.prepMinutes(tx) : 0;
    const plan = planDecision(b, req, { vehicles, blocking, prepMinutes: prep, nowLocal: store.nowLocal() });
    if (!plan.ok) return plan;
    await store.apply(tx, plan.patch, b);
    return { ok: true as const, plan, booking: b };
  });

  if (!outcome.ok) {
    return { status: outcome.status, message: outcome.message, ...(outcome.freeVehicleIds ? { freeVehicleIds: outcome.freeVehicleIds } : {}) };
  }

  const { plan } = outcome;
  const vehicleId = plan.patch.status === "CONFIRMED" ? plan.patch.vehicleId : outcome.booking.vehicleId;
  const base = { status: plan.patch.status, vehicleId };
  if (!req.notify) return { status: 200, data: { ...base, email: "not_requested", emailError: null } };

  // Από εδώ και κάτω ΤΙΠΟΤΑ δεν αναιρεί την αλλαγή κατάστασης.
  try {
    const email = await deliverEmail(plan.kind, messages);
    return { status: 200, data: { ...base, ...email } };
  } catch (e) {
    log(`απρόβλεπτο σφάλμα (${e instanceof Error ? e.name : "?"})`);
    return { status: 200, data: { ...base, email: "failed", emailError: "send_failed" } };
  }
}

/** Αποστολή του email ενός είδους — ΠΟΤΕ δεύτερη φορά, ΠΟΤΕ exception προς τα έξω. */
export async function deliverEmail(
  kind: MessageKind,
  deps: MessageDeps
): Promise<{ email: EmailOutcome; emailError: string | null }> {
  if (emailAlreadySent(await deps.loadNotifications(), kind)) return { email: "already_sent", emailError: null };

  const built = await deps.buildMessage(kind);
  if (!built || !built.to) return { email: "no_email", emailError: null };
  const { message } = built;

  const apiKey = deps.apiKey?.trim();
  const from = deps.from?.trim();
  if (!apiKey || !from) {
    await deps.record({ kind, channel: "email", result: "failed", error: "not_configured", lang: message.lang });
    log("δεν έχει ρυθμιστεί (RESEND_API_KEY / EMAIL_FROM)");
    return { email: "not_configured", emailError: "not_configured" };
  }

  let error: string | null;
  try {
    ({ error } = await deps.send(apiKey, {
      from,
      to: built.to,
      ...(built.replyTo ? { replyTo: built.replyTo } : {}),
      subject: message.subject,
      text: message.text,
      html: message.html,
    }));
  } catch {
    error = "send_failed";
  }
  await deps.record({ kind, channel: "email", result: error ? "failed" : "sent", error, lang: message.lang });
  if (error) {
    log(`αποτυχία (${error})`);
    return { email: "failed", emailError: error };
  }
  return { email: "sent", emailError: null };
}
