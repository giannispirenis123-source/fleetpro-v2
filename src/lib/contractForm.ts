// src/lib/contractForm.ts
// Zod schemas, snapshot και ερωτήματα των Συμβολαίων.
//
// Ζουν εδώ και όχι μέσα στα route.ts: τα αρχεία διαδρομής του Next.js
// επιτρέπουν μόνο συγκεκριμένα exports (GET, POST, dynamic κ.λπ.).
//
// Server-only: εισάγει db.

import { z } from "zod";
import { Prisma, type Contract } from "@prisma/client";
import { db } from "./db";
import type { Viewer } from "./authz";
import { readExtrasSnapshot } from "./pricing";
import { discountOfBooking, priceBooking } from "./bookingPricing";
import { countDays } from "./bookings";
import { bookingScope } from "./authz";
import {
  CARD_BRANDS,
  CARD_EXPIRY_RE,
  LAST4_RE,
  anySigned,
  buildSearchText,
  dateSearchForms,
  depositUsesCard,
  paymentUsesCard,
  phoneSearchForms,
  readCard,
  searchTokens,
  DEPOSIT_METHODS,
  DRIVER_FIELDS,
  ID_TYPES,
  PAYMENT_METHODS,
  FUEL_STEPS,
  emptyDriver,
  randomContractCode,
  randomId,
  readChanges,
  readDrivers,
  readMarks,
  readSnapshot,
  type ContractDTO,
  type ContractDriver,
  type ContractListItem,
  type ContractSnapshot,
  type ContractStatusValue,
  type DepositMethod,
  type ExtrasLock,
  type PaymentMethod,
} from "./contracts";

/** Ο client της βάσης: το κοινό `db` ή μια transaction. */
type Client = Prisma.TransactionClient | typeof db;

/* ─────────────────────────────────────────────
   Στεγανότητα
   ───────────────────────────────────────────── */

/**
 * Το WHERE κάθε ερωτήματος συμβολαίων. Ο συνεργάτης βλέπει ΜΟΝΟ τα
 * συμβόλαια των κρατήσεων που έφερε ο ίδιος — στο ερώτημα, όχι στο UI.
 */
export function contractScope(viewer: Viewer): Prisma.ContractWhereInput {
  const base: Prisma.ContractWhereInput = { tenantId: viewer.tenantId! };
  return viewer.role === "PARTNER"
    ? { ...base, booking: { partnerId: viewer.userId } }
    : base;
}

/* ─────────────────────────────────────────────
   Zod
   ───────────────────────────────────────────── */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Μη έγκυρη ημερομηνία");

const optionalDate = z.union([isoDate, z.literal("")]);
const text = (max: number) => z.string().max(max).transform((s) => s.trim());

const driverSchema = z.object({
  id: z.string().min(1).max(40),
  fullName: text(200),
  country: text(100),
  licenseNumber: text(100),
  licenseExpiry: optionalDate,
  birthDate: optionalDate,
  idType: z.enum(ID_TYPES),
  idNumber: text(100),
  phone: text(50),
  email: text(200),
  address: text(500),
});

const markSchema = z.object({
  id: z.string().min(1).max(40),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  note: text(200),
});

const changeSchema = z.object({
  id: z.string().min(1).max(40),
  vehicleId: z.string().min(1),
  date: isoDate,
});

const eighths = z.number().int().min(0).max(FUEL_STEPS);

/**
 * Κάρτα: ΜΟΝΟ τύπος, 4 τελευταία ψηφία, κάτοχος, λήξη. Το schema είναι
 * `strict`: ένα πεδίο όπως πλήρης αριθμός ή CVV απορρίπτει όλο το αίτημα
 * αντί να αγνοηθεί σιωπηλά.
 */
const cardSchema = z
  .object({
    brand: z.enum(CARD_BRANDS),
    last4: z.string().regex(LAST4_RE, "Δώσε ακριβώς τα 4 τελευταία ψηφία της κάρτας"),
    holder: text(100),
    expiry: z.string().regex(CARD_EXPIRY_RE, "Λήξη κάρτας σε μορφή ΜΜ/ΕΕ (μήνας 01–12)"),
  })
  .strict();

/**
 * Όλα προαιρετικά: η φόρμα στέλνει ολόκληρη την κατάσταση της, αλλά ο
 * server κρίνει τι επιτρέπεται να αλλάξει ανάλογα με την κατάσταση.
 * Κανένα ποσό κράτησης δεν έρχεται από τον client.
 */
export const contractPatchSchema = z.object({
  /* ── Στοιχεία παραλαβής (κλειδώνουν με την υπογραφή όλων) ── */
  drivers: z.array(driverSchema).min(1, "Χρειάζεται τουλάχιστον ένας οδηγός").max(20).optional(),
  pickupLocation: text(200).optional(),
  returnLocation: text(200).optional(),
  fuelPickup: z.union([eighths, z.null()]).optional(),
  damageMarks: z.array(markSchema).max(60).optional(),
  paymentMethod: z.union([z.enum(PAYMENT_METHODS), z.null()]).optional(),
  depositAmount: z.union([z.number().min(0).max(1_000_000), z.null()]).optional(),
  depositMethod: z.union([z.enum(DEPOSIT_METHODS), z.null()]).optional(),
  paymentCard: z.union([cardSchema, z.null()]).optional(),
  depositCard: z.union([cardSchema, z.null()]).optional(),
  gdprConsent: z.boolean().optional(),

  /* ── Πρόσθετα: αλλάζουν ΚΑΙ την κράτηση (ίδιο σύνολο παντού) ── */
  extraIds: z.array(z.string().min(1)).max(50).optional(),

  /* ── Επιτρέπονται και μετά την υπογραφή ── */
  fuelReturn: z.union([eighths, z.null()]).optional(),
  vehicleChanges: z.array(changeSchema).max(30).optional(),
  notes: text(5000).optional(),
});

export type ContractPatch = z.infer<typeof contractPatchSchema>;

/** Τα πεδία που επιτρέπονται και μετά την υπογραφή όλων. */
export const AFTER_SIGN_FIELDS = ["fuelReturn", "vehicleChanges", "notes"] as const;

/** Υπογραφή: PNG σε data URL. ~700KB όριο — ένα σχέδιο με δάχτυλο είναι λίγα KB. */
export const signSchema = z.object({
  driverId: z.string().min(1).max(40),
  signature: z.union([
    z
      .string()
      .max(700_000, "Η υπογραφή είναι πολύ μεγάλη")
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Μη έγκυρη υπογραφή"),
    z.null(),
  ]),
});

/* ─────────────────────────────────────────────
   Snapshot — ΜΟΝΟ από τη βάση
   ───────────────────────────────────────────── */

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Φωτογραφία της στιγμής: εταιρία, κράτηση, όχημα, τιμές (από το snapshot
 * της ΚΡΑΤΗΣΗΣ — όχι σημερινές τιμές), ασφάλεια με απαλλαγή, όροι.
 */
export async function buildSnapshot(
  tenantId: string,
  bookingId: string,
  client: Client = db
): Promise<ContractSnapshot | null> {
  const [tenant, booking] = await Promise.all([
    client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        region: true,
        vat: true,
        taxOffice: true,
        phone: true,
        email: true,
        address: true,
        logoUrl: true,
        contractTermsEl: true,
        contractTermsEn: true,
        vatRate: true,
      },
    }),
    client.booking.findFirst({
      where: { id: bookingId, tenantId },
      include: {
        vehicle: { select: { id: true, brand: true, model: true, plate: true, fuel: true } },
      },
    }),
  ]);
  if (!tenant || !booking) return null;

  const lines = readExtrasSnapshot(booking.extras);
  const insuranceLines = lines.filter((l) => l.type === "INSURANCE");

  // Η απαλλαγή δεν υπάρχει στο snapshot της κράτησης: τη διαβάζουμε από
  // την ασφάλεια (Πρόσθετα) και την παγώνουμε εδώ, στο συμβόλαιο.
  const excessRows = insuranceLines.length
    ? await client.extra.findMany({
        where: { tenantId, id: { in: insuranceLines.map((l) => l.id) } },
        select: { id: true, excess: true },
      })
    : [];
  const excessById = new Map(
    excessRows.map((e) => [e.id, e.excess === null ? null : Number(e.excess)])
  );

  return {
    company: {
      name: tenant.name,
      region: tenant.region ?? "",
      vat: tenant.vat ?? "",
      taxOffice: tenant.taxOffice ?? "",
      phone: tenant.phone ?? "",
      email: tenant.email,
      address: tenant.address ?? "",
      logoUrl: tenant.logoUrl,
    },
    booking: {
      number: booking.bookingNumber,
      pickupDate: dateOnly(booking.pickupDate),
      pickupTime: booking.pickupTime,
      returnDate: dateOnly(booking.returnDate),
      returnTime: booking.returnTime,
      totalDays: booking.totalDays,
      dailyRate: Number(booking.dailyRate),
      subtotal: Number(booking.subtotal),
      extrasTotal: Number(booking.extrasTotal),
      insuranceCost: Number(booking.insuranceCost),
      discountAmount: Number(booking.discountAmount),
      discountCode: booking.discountCode,
      total: Number(booking.total),
    },
    vehicle: {
      id: booking.vehicle.id,
      brand: booking.vehicle.brand,
      model: booking.vehicle.model,
      plate: booking.vehicle.plate,
      fuel: booking.vehicle.fuel,
    },
    extras: lines
      .filter((l) => l.type !== "INSURANCE")
      .map((l) => ({ name: l.name, lineTotal: l.lineTotal })),
    insurance: insuranceLines.map((l) => ({
      name: l.name,
      lineTotal: l.lineTotal,
      excess: excessById.get(l.id) ?? null,
    })),
    terms: {
      el: tenant.contractTermsEl ?? "",
      en: tenant.contractTermsEn ?? "",
    },
    vatRate: Number(tenant.vatRate),
    takenAt: new Date().toISOString(),
  };
}

/** Ο κύριος οδηγός, προσυμπληρωμένος από τον πελάτη της κράτησης. */
export async function mainDriverFromCustomer(
  tenantId: string,
  customerId: string
): Promise<ContractDriver> {
  const c = await db.customer.findFirst({ where: { id: customerId, tenantId } });
  const driver = emptyDriver(randomId());
  if (!c) return driver;

  return {
    ...driver,
    fullName: `${c.firstName} ${c.lastName}`.trim(),
    country: c.licenseCountry ?? c.country ?? "",
    licenseNumber: c.licenseNumber ?? "",
    licenseExpiry: c.licenseExpiry ? dateOnly(c.licenseExpiry) : "",
    birthDate: c.dateOfBirth ? dateOnly(c.dateOfBirth) : "",
    idType: "ID",
    idNumber: c.idNumber ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    address: [c.address, c.city, c.country].filter(Boolean).join(", "),
  };
}

/* ─────────────────────────────────────────────
   Δημιουργία
   ───────────────────────────────────────────── */

/**
 * Νέο συμβόλαιο για κράτηση. Ο κωδικός είναι τυχαίος: σε (απίθανη)
 * σύγκρουση με υπάρχοντα, ξαναδοκιμάζουμε με νέο.
 */
export async function createContract(
  viewer: Viewer,
  userName: string,
  booking: {
    id: string;
    customerId: string;
    pickupLocation: string | null;
    returnLocation: string | null;
    deposit: Prisma.Decimal;
  }
): Promise<Contract> {
  const tenantId = viewer.tenantId!;
  const [snapshot, mainDriver] = await Promise.all([
    buildSnapshot(tenantId, booking.id),
    mainDriverFromCustomer(tenantId, booking.customerId),
  ]);

  const deposit = Number(booking.deposit);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await db.contract.create({
        data: {
          tenantId,
          bookingId: booking.id,
          customerId: booking.customerId,
          contractNumber: randomContractCode(),
          createdById: viewer.userId,
          createdByName: userName,
          snapshot: (snapshot ?? {}) as unknown as Prisma.InputJsonValue,
          drivers: [mainDriver] as unknown as Prisma.InputJsonValue,
          pickupLocation: booking.pickupLocation,
          returnLocation: booking.returnLocation,
          depositAmount: deposit > 0 ? deposit : null,
        },
      });
      await refreshSearchText(created.id);
      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = String(error.meta?.target ?? "");
        // Άλλος πρόλαβε να φτιάξει συμβόλαιο για την ίδια κράτηση.
        if (target.includes("bookingId")) throw error;
        continue; // ίδιος κωδικός — νέα προσπάθεια
      }
      throw error;
    }
  }
  throw new Error("Δεν βρέθηκε ελεύθερος κωδικός συμβολαίου");
}

/* ─────────────────────────────────────────────
   Σύγκριση — άλλαξαν τα στοιχεία παραλαβής;
   ───────────────────────────────────────────── */

const sameDrivers = (a: ContractDriver[], b: ContractPatch["drivers"]) =>
  !b ||
  (a.length === b.length &&
    a.every(
      (d, i) =>
        d.id === b[i].id &&
        DRIVER_FIELDS.every((f) => d[f] === (b[i] as Record<string, string>)[f])
    ));

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Λέει ποια από τα κλειδώσιμα πεδία αλλάζουν ΠΡΑΓΜΑΤΙΚΑ. Η φόρμα στέλνει
 * όλη την κατάσταση· ένα πεδίο ίδιο με το αποθηκευμένο δεν μετρά ως αλλαγή.
 */
export function pickupChanged(current: Contract, patch: ContractPatch): boolean {
  const drivers = readDrivers(current.drivers);
  const deposit = current.depositAmount === null ? null : Number(current.depositAmount);

  const checks: boolean[] = [
    !sameDrivers(drivers, patch.drivers),
    patch.pickupLocation !== undefined && patch.pickupLocation !== (current.pickupLocation ?? ""),
    patch.returnLocation !== undefined && patch.returnLocation !== (current.returnLocation ?? ""),
    patch.fuelPickup !== undefined && patch.fuelPickup !== current.fuelPickup,
    patch.damageMarks !== undefined && !sameJson(readMarks(current.damageMarks), patch.damageMarks),
    patch.paymentMethod !== undefined && patch.paymentMethod !== current.paymentMethod,
    patch.depositAmount !== undefined && patch.depositAmount !== deposit,
    patch.depositMethod !== undefined && patch.depositMethod !== current.depositMethod,
    patch.paymentCard !== undefined && !sameJson(readCard(current.paymentCard), patch.paymentCard),
    patch.depositCard !== undefined && !sameJson(readCard(current.depositCard), patch.depositCard),
    patch.gdprConsent !== undefined && patch.gdprConsent !== current.gdprConsent,
  ];
  return checks.some(Boolean);
}

/**
 * Οι νέοι οδηγοί, με τις υπογραφές που υπήρχαν. Όταν `resetSignatures`,
 * σβήνονται όλες — το κείμενο που υπέγραψαν άλλαξε.
 */
export function mergeDrivers(
  current: ContractDriver[],
  next: NonNullable<ContractPatch["drivers"]>,
  resetSignatures: boolean
): ContractDriver[] {
  const byId = new Map(current.map((d) => [d.id, d]));
  return next.map((d) => {
    const old = byId.get(d.id);
    return {
      ...d,
      signature: resetSignatures ? null : (old?.signature ?? null),
      signedAt: resetSignatures ? null : (old?.signedAt ?? null),
    };
  });
}

/** Οι αλλαγές οχήματος με μοντέλο/πινακίδα από τον Στόλο — όχι από τον client. */
export async function resolveVehicleChanges(
  tenantId: string,
  changes: NonNullable<ContractPatch["vehicleChanges"]>
) {
  if (changes.length === 0) return { ok: true as const, changes: [] };

  const vehicles = await db.vehicle.findMany({
    where: { tenantId, id: { in: changes.map((c) => c.vehicleId) } },
    select: { id: true, brand: true, model: true, plate: true },
  });
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  const out = [];
  for (const c of changes) {
    const v = byId.get(c.vehicleId);
    if (!v) return { ok: false as const, message: "Το όχημα της αλλαγής δεν βρέθηκε" };
    out.push({
      id: c.id,
      vehicleId: v.id,
      label: `${v.brand} ${v.model}`,
      plate: v.plate,
      date: c.date,
    });
  }
  return { ok: true as const, changes: out };
}

/* ─────────────────────────────────────────────
   DTO & ερωτήματα
   ───────────────────────────────────────────── */

export const CONTRACT_INCLUDE = {
  booking: {
    select: {
      bookingNumber: true,
      status: true,
      total: true,
      extras: true,
      invoice: { select: { id: true } },
    },
  },
} as const;

type ContractWithBooking = Contract & {
  booking: {
    bookingNumber: string;
    status: string;
    total: Prisma.Decimal;
    extras: Prisma.JsonValue;
    invoice: { id: string } | null;
  };
};

/**
 * Γιατί δεν αλλάζουν τα πρόσθετα — ο ΙΔΙΟΣ κανόνας για UI και server.
 * Αλλάζουν μόνο πριν την πρώτη υπογραφή, όσο η κράτηση δεν έχει
 * τιμολόγιο και δεν είναι ολοκληρωμένη/ακυρωμένη.
 */
export function extrasLockOf(
  drivers: ContractDriver[],
  booking: { status: string; invoice: { id: string } | null }
): ExtrasLock | null {
  if (anySigned(drivers)) return "signed";
  if (booking.invoice) return "invoiced";
  if (booking.status === "COMPLETED" || booking.status === "CANCELLED") return "closed";
  return null;
}

export function toContractDTO(c: ContractWithBooking): ContractDTO {
  const drivers = readDrivers(c.drivers);
  return {
    id: c.id,
    contractNumber: c.contractNumber,
    status: c.status as ContractStatusValue,
    bookingId: c.bookingId,
    bookingNumber: c.booking.bookingNumber,
    bookingStatus: c.booking.status,
    createdByName: c.createdByName,
    snapshot: readSnapshot(c.snapshot),
    drivers,
    pickupLocation: c.pickupLocation ?? "",
    returnLocation: c.returnLocation ?? "",
    fuelPickup: c.fuelPickup,
    fuelReturn: c.fuelReturn,
    damageMarks: readMarks(c.damageMarks),
    vehicleChanges: readChanges(c.vehicleChanges),
    notes: c.notes ?? "",
    paymentMethod: (c.paymentMethod as PaymentMethod | null) ?? null,
    depositAmount: c.depositAmount === null ? null : Number(c.depositAmount),
    depositMethod: (c.depositMethod as DepositMethod | null) ?? null,
    // readCard κρατά ΜΟΝΟ τα 4 επιτρεπτά πεδία.
    paymentCard: readCard(c.paymentCard),
    depositCard: readCard(c.depositCard),
    gdprConsent: c.gdprConsent,
    signedAt: c.signedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    bookingExtraIds: readExtrasSnapshot(c.booking.extras).map((l) => l.id),
    bookingTotalNow: Number(c.booking.total),
    extrasLock: extrasLockOf(drivers, c.booking),
  };
}

export async function loadContract(
  viewer: Viewer,
  id: string
): Promise<ContractDTO | null> {
  const c = await db.contract.findFirst({
    where: { ...contractScope(viewer), id },
    include: CONTRACT_INCLUDE,
  });
  return c ? toContractDTO(c) : null;
}

/**
 * Πρόχειρο χωρίς υπογραφές: το snapshot ακολουθεί την κράτηση. Αν κάποιος
 * άλλαξε την κράτηση από τη σελίδα Κρατήσεις, η φόρμα το βλέπει αμέσως.
 * Υπογεγραμμένο συμβόλαιο δεν αγγίζεται ποτέ (νομικό έγγραφο).
 */
export async function refreshDraftSnapshot(viewer: Viewer, id: string) {
  const c = await db.contract.findFirst({
    where: { ...contractScope(viewer), id, status: "DRAFT" },
    select: { id: true, bookingId: true, drivers: true, updatedAt: true },
  });
  if (!c || anySigned(readDrivers(c.drivers))) return;
  const snapshot = await buildSnapshot(viewer.tenantId!, c.bookingId);
  if (!snapshot) return;
  await db.contract.updateMany({
    where: { id: c.id, updatedAt: c.updatedAt },
    data: { snapshot: snapshot as unknown as Prisma.InputJsonValue },
  });
}

/* ─────────────────────────────────────────────
   Κείμενο αναζήτησης
   ───────────────────────────────────────────── */

const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * Ξαναϋπολογίζει και αποθηκεύει το searchText ενός συμβολαίου. Καλείται
 * μετά από κάθε δημιουργία, αποθήκευση, υπογραφή, ολοκλήρωση.
 */
export async function refreshSearchText(contractId: string, client: Client = db) {
  const c = await client.contract.findUnique({
    where: { id: contractId },
    select: {
      contractNumber: true,
      drivers: true,
      vehicleChanges: true,
      pickupLocation: true,
      returnLocation: true,
      notes: true,
      createdByName: true,
      createdAt: true,
      customer: { select: { firstName: true, lastName: true, phone: true, email: true } },
      booking: {
        select: {
          bookingNumber: true,
          pickupDate: true,
          returnDate: true,
          vehicle: { select: { brand: true, model: true, plate: true } },
        },
      },
    },
  });
  if (!c) return;

  const changes = readChanges(c.vehicleChanges);
  const values: string[] = [
    c.contractNumber,
    c.booking.bookingNumber,
    c.booking.vehicle.plate,
    `${c.booking.vehicle.brand} ${c.booking.vehicle.model}`,
    ...changes.flatMap((v) => [v.plate, v.label, ...dateSearchForms(v.date)]),
    `${c.customer.firstName} ${c.customer.lastName}`,
    c.customer.email ?? "",
    ...phoneSearchForms(c.customer.phone ?? ""),
    ...readDrivers(c.drivers).flatMap((d) => [
      d.fullName,
      d.email,
      ...phoneSearchForms(d.phone),
      d.licenseNumber,
      d.idNumber,
      d.country,
      d.address,
    ]),
    c.pickupLocation ?? "",
    c.returnLocation ?? "",
    c.notes ?? "",
    c.createdByName ?? "",
    ...dateSearchForms(isoDay(c.booking.pickupDate)),
    ...dateSearchForms(isoDay(c.booking.returnDate)),
    ...dateSearchForms(isoDay(c.createdAt)),
  ];

  // Καλείται ΜΕΤΑ την εγγραφή κάθε ενέργειας (και μετά τον έλεγχο
  // αισιόδοξου κλειδώματος): αγγίζει μόνο αυτή τη στήλη.
  await client.contract.update({
    where: { id: contractId },
    data: { searchText: buildSearchText(values) },
    select: { id: true },
  });
}

/**
 * Lazy backfill: συμβόλαια χωρίς searchText (παλιά, πριν τη στήλη)
 * αποκτούν ένα πριν την αναζήτηση. Μέχρι 200 ανά φορά, μέσα στην εταιρία.
 */
async function backfillSearchText(viewer: Viewer) {
  const missing = await db.contract.findMany({
    where: { ...contractScope(viewer), searchText: null },
    select: { id: true },
    take: 200,
  });
  for (const m of missing) await refreshSearchText(m.id);
}

/* ─────────────────────────────────────────────
   Λίστα με αναζήτηση και σελίδες
   ───────────────────────────────────────────── */

export const CONTRACTS_PAGE_SIZE = 25;

export interface ContractListPage {
  contracts: ContractListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Λίστα — χωρίς snapshot· οι οδηγοί μόνο για να μετρηθούν. */
export async function loadContractList(
  viewer: Viewer,
  filters: { status?: string | null; q?: string | null; page?: number }
): Promise<ContractListPage> {
  const status =
    filters.status && ["DRAFT", "SIGNED", "COMPLETED"].includes(filters.status)
      ? (filters.status as ContractStatusValue)
      : null;
  const tokens = searchTokens(filters.q ?? "");
  if (tokens.length) await backfillSearchText(viewer);

  const where: Prisma.ContractWhereInput = {
    // Στεγανότητα ΠΑΝΤΑ, και μέσα στην αναζήτηση.
    ...contractScope(viewer),
    ...(status ? { status } : {}),
    // Κάθε λέξη πρέπει να ταιριάζει (AND). LIKE στο κανονικοποιημένο
    // κείμενο — το GIN trigram index το εξυπηρετεί.
    ...(tokens.length
      ? { AND: tokens.map((t) => ({ searchText: { contains: t } })) }
      : {}),
  };

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const [total, rows] = await Promise.all([
    db.contract.count({ where }),
    db.contract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * CONTRACTS_PAGE_SIZE,
      take: CONTRACTS_PAGE_SIZE,
      select: {
        id: true,
        contractNumber: true,
        status: true,
        bookingId: true,
        drivers: true,
        createdByName: true,
        createdAt: true,
        customer: { select: { firstName: true, lastName: true } },
        booking: {
          select: {
            bookingNumber: true,
            pickupDate: true,
            returnDate: true,
            vehicle: { select: { brand: true, model: true, plate: true } },
          },
        },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize: CONTRACTS_PAGE_SIZE,
    contracts: rows.map((r) => {
      const drivers = readDrivers(r.drivers);
      return {
        id: r.id,
        contractNumber: r.contractNumber,
        status: r.status as ContractStatusValue,
        bookingId: r.bookingId,
        bookingNumber: r.booking.bookingNumber,
        customerName: `${r.customer.firstName} ${r.customer.lastName}`,
        vehicleLabel: `${r.booking.vehicle.brand} ${r.booking.vehicle.model} · ${r.booking.vehicle.plate}`,
        pickupDate: dateOnly(r.booking.pickupDate),
        returnDate: dateOnly(r.booking.returnDate),
        drivers: drivers.length,
        signedDrivers: drivers.filter((d) => d.signature).length,
        createdByName: r.createdByName,
        createdAt: r.createdAt.toISOString(),
      };
    }),
  };
}

/* ─────────────────────────────────────────────
   Κρατήσεις χωρίς συμβόλαιο («+ Νέο συμβόλαιο»)
   ───────────────────────────────────────────── */

export interface BookingWithoutContract {
  id: string;
  bookingNumber: string;
  status: string;
  customerName: string;
  vehicleLabel: string;
  pickupDate: string;
  returnDate: string;
}

export async function loadBookingsWithoutContract(
  viewer: Viewer,
  q: string | null
): Promise<BookingWithoutContract[]> {
  const term = q?.trim();
  const rows = await db.booking.findMany({
    where: {
      // Στεγανότητα συνεργάτη, όπως σε κάθε ερώτημα κρατήσεων.
      ...bookingScope(viewer),
      status: { not: "CANCELLED" },
      contract: { is: null },
      ...(term
        ? {
            OR: [
              { bookingNumber: { contains: term, mode: "insensitive" } },
              { customer: { firstName: { contains: term, mode: "insensitive" } } },
              { customer: { lastName: { contains: term, mode: "insensitive" } } },
              { customer: { phone: { contains: term, mode: "insensitive" } } },
              { vehicle: { plate: { contains: term, mode: "insensitive" } } },
              { vehicle: { model: { contains: term, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { pickupDate: "desc" },
    take: 50,
    select: {
      id: true,
      bookingNumber: true,
      status: true,
      pickupDate: true,
      returnDate: true,
      customer: { select: { firstName: true, lastName: true } },
      vehicle: { select: { brand: true, model: true, plate: true } },
    },
  });

  return rows.map((b) => ({
    id: b.id,
    bookingNumber: b.bookingNumber,
    status: b.status,
    customerName: `${b.customer.firstName} ${b.customer.lastName}`,
    vehicleLabel: `${b.vehicle.brand} ${b.vehicle.model} · ${b.vehicle.plate}`,
    pickupDate: dateOnly(b.pickupDate),
    returnDate: dateOnly(b.returnDate),
  }));
}

/* ─────────────────────────────────────────────
   Πρόσθετα: ΕΝΑ σύνολο για κράτηση και συμβόλαιο
   ───────────────────────────────────────────── */

/**
 * Ξαναϋπολογίζει την κράτηση με τα νέα πρόσθετα — με τον ΙΔΙΟ κώδικα που
 * χρησιμοποιεί το PATCH κράτησης (priceBooking + ίδια έκπτωση). Επιστρέφει
 * τα δεδομένα ενημέρωσης· η εγγραφή γίνεται από τον καλούντα μέσα σε
 * transaction μαζί με το snapshot του συμβολαίου.
 */
export async function priceBookingExtras(
  tenantId: string,
  bookingId: string,
  extraIds: string[]
): Promise<
  | { ok: true; data: Prisma.BookingUpdateInput }
  | { ok: false; message: string }
> {
  const booking = await db.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: {
      vehicleId: true,
      customerId: true,
      pickupDate: true,
      returnDate: true,
      discountCode: true,
      discountAmount: true,
    },
  });
  if (!booking) return { ok: false, message: "Η κράτηση δεν βρέθηκε" };

  const priced = await priceBooking({
    tenantId,
    vehicleId: booking.vehicleId,
    customerId: booking.customerId,
    totalDays: countDays(dateOnly(booking.pickupDate), dateOnly(booking.returnDate)),
    extraIds,
    ...discountOfBooking(booking),
  });
  if (!priced.ok) return priced;

  const b = priced.breakdown;
  return {
    ok: true,
    data: {
      dailyRate: priced.dailyRate,
      totalDays: b.totalDays,
      subtotal: b.subtotal,
      extrasTotal: b.extrasTotal,
      insuranceCost: b.insuranceCost,
      discountAmount: b.discountAmount,
      discountCode: priced.discountCode,
      total: b.total,
      extras: priced.snapshot as unknown as Prisma.InputJsonValue,
    },
  };
}

/** Οι κάρτες ισχύουν μόνο με τον αντίστοιχο τρόπο — αλλιώς σβήνονται. */
export function cardsFor(
  paymentMethod: string | null,
  depositMethod: string | null,
  patch: ContractPatch,
  current: Contract
) {
  const payment =
    patch.paymentCard !== undefined ? patch.paymentCard : readCard(current.paymentCard);
  const deposit =
    patch.depositCard !== undefined ? patch.depositCard : readCard(current.depositCard);
  return {
    paymentCard: paymentUsesCard(paymentMethod) && payment ? payment : null,
    depositCard: depositUsesCard(depositMethod) && deposit ? deposit : null,
  };
}

/** Η IP του αιτήματος, όπως τη δίνει ο proxy του Vercel. */
export function requestIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : headers.get("x-real-ip");
}
