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
import {
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
  type PaymentMethod,
} from "./contracts";

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
  gdprConsent: z.boolean().optional(),

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
  bookingId: string
): Promise<ContractSnapshot | null> {
  const [tenant, booking] = await Promise.all([
    db.tenant.findUnique({
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
      },
    }),
    db.booking.findFirst({
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
    ? await db.extra.findMany({
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
      return await db.contract.create({
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
  booking: { select: { bookingNumber: true, status: true } },
} as const;

type ContractWithBooking = Contract & {
  booking: { bookingNumber: string; status: string };
};

export function toContractDTO(c: ContractWithBooking): ContractDTO {
  return {
    id: c.id,
    contractNumber: c.contractNumber,
    status: c.status as ContractStatusValue,
    bookingId: c.bookingId,
    bookingNumber: c.booking.bookingNumber,
    bookingStatus: c.booking.status,
    createdByName: c.createdByName,
    snapshot: readSnapshot(c.snapshot),
    drivers: readDrivers(c.drivers),
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
    gdprConsent: c.gdprConsent,
    signedAt: c.signedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
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

/** Λίστα — χωρίς το snapshot· οι οδηγοί μόνο για να μετρηθούν. */
export async function loadContractList(
  viewer: Viewer,
  filters: { status?: string | null; q?: string | null }
): Promise<ContractListItem[]> {
  const status =
    filters.status && ["DRAFT", "SIGNED", "COMPLETED"].includes(filters.status)
      ? (filters.status as ContractStatusValue)
      : null;
  const q = filters.q?.trim();

  const rows = await db.contract.findMany({
    where: {
      ...contractScope(viewer),
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { contractNumber: { contains: q, mode: "insensitive" } },
              { booking: { bookingNumber: { contains: q, mode: "insensitive" } } },
              { customer: { firstName: { contains: q, mode: "insensitive" } } },
              { customer: { lastName: { contains: q, mode: "insensitive" } } },
              { booking: { vehicle: { plate: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
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
  });

  return rows.map((r) => {
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
  });
}

/** Η IP του αιτήματος, όπως τη δίνει ο proxy του Vercel. */
export function requestIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : headers.get("x-real-ip");
}
