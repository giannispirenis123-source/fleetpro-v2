// src/lib/public/bookingRequest.ts
// Η φόρμα κράτησης του δημόσιου site — ΚΑΘΑΡΗ λογική (χωρίς βάση).
//
// · Έλεγχος εισόδου (zod): μήκη, email, τηλέφωνο με κωδικό χώρας, ημερομηνία
//   γέννησης, πτήση, σχόλια (χωρίς HTML), αποδοχή όρων, honeypot.
// · Ηλικία: η ημερομηνία γέννησης πρέπει να πέφτει στην ΙΔΙΑ κλίμακα με την
//   ηλικία της αναζήτησης (αλλιώς η τιμή θα ήταν λάθος).
// · Κωδικός κράτησης: ίδια λογική/αλφάβητο με τον κωδικό τιμολογίου.
// · DTO επιβεβαίωσης: ΜΟΝΟ δημόσια πεδία (μικρό όνομα, μασκαρισμένο email).
//
// Κανένα ποσό δεν διαβάζεται από τον browser: δεν υπάρχει καν πεδίο ποσού.

import { z } from "zod";
import { ageAt } from "./engine";
import type { QuoteLine } from "./pricing";
import type { SearchAgeBand } from "./search";

/* ─────────────────────────────────────────────
   Όρια / μορφές
   ───────────────────────────────────────────── */

export const NAME_MAX = 100;
export const NOTES_MAX = 500;
export const EMAIL_MAX = 160;

/** Κωδικοί χώρας για το τηλέφωνο (οι πιο συχνοί πρώτα). */
export const PHONE_COUNTRIES = [
  { code: "+30", label: "GR +30" },
  { code: "+44", label: "UK +44" },
  { code: "+49", label: "DE +49" },
  { code: "+33", label: "FR +33" },
  { code: "+48", label: "PL +48" },
  { code: "+39", label: "IT +39" },
  { code: "+31", label: "NL +31" },
  { code: "+32", label: "BE +32" },
  { code: "+46", label: "SE +46" },
  { code: "+47", label: "NO +47" },
  { code: "+45", label: "DK +45" },
  { code: "+358", label: "FI +358" },
  { code: "+43", label: "AT +43" },
  { code: "+41", label: "CH +41" },
  { code: "+420", label: "CZ +420" },
  { code: "+36", label: "HU +36" },
  { code: "+40", label: "RO +40" },
  { code: "+359", label: "BG +359" },
  { code: "+357", label: "CY +357" },
  { code: "+34", label: "ES +34" },
  { code: "+351", label: "PT +351" },
  { code: "+353", label: "IE +353" },
  { code: "+972", label: "IL +972" },
  { code: "+90", label: "TR +90" },
  { code: "+1", label: "US/CA +1" },
  { code: "+61", label: "AU +61" },
] as const;

const PHONE_CODES = new Set<string>(PHONE_COUNTRIES.map((c) => c.code));

/** Χωρίς HTML/χαρακτήρες ελέγχου, χωρίς περιττά κενά. */
export function cleanText(v: string, max: number): string {
  return v
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

/** Ψηφία τηλεφώνου (χωρίς κενά/παύλες/παρενθέσεις, χωρίς αρχικό 0 του εθνικού). */
export function phoneDigits(v: string): string {
  return v.replace(/[\s\-().]/g, "").replace(/^0+/, "");
}

export const FLIGHT_RE = /^[A-Z0-9]{2,3}\s?\d{1,4}[A-Z]?$/;

/** Μορφή κριτηρίων (ίδια με το URL της αναζήτησης). */
const criteriaSchema = z.object({
  pl: z.string().max(64).nullable(),
  dl: z.string().max(64).nullable(),
  from: z.string().max(16),
  to: z.string().max(16),
  age: z.number().int().min(16).max(120).nullable(),
});

export const publicBookingSchema = z.object({
  slug: z.string().min(1).max(64),
  lang: z.string().min(2).max(5),
  /** Η κάρτα: "g.<code>" ή "v.<id>". */
  key: z.string().min(3).max(70),
  criteria: criteriaSchema,
  extras: z.array(z.object({ id: z.string().min(1).max(64), qty: z.number().int().min(1).max(10) })).max(20).default([]),
  /** null = καμία ασφάλεια· undefined = η προεπιλεγμένη. */
  insuranceId: z.string().min(1).max(64).nullable().optional(),
  firstName: z.string().max(NAME_MAX),
  lastName: z.string().max(NAME_MAX),
  email: z.string().max(EMAIL_MAX),
  phoneCountry: z.string().max(5),
  phone: z.string().max(30),
  birthDate: z.string().max(10),
  flightNumber: z.string().max(12).optional().default(""),
  notes: z.string().max(NOTES_MAX * 2).optional().default(""),
  acceptTerms: z.boolean(),
  /** Honeypot: κρυφό πεδίο — άνθρωπος δεν το βλέπει, bot το γεμίζει. */
  website: z.string().max(200).optional().default(""),
});

export type PublicBookingInput = z.infer<typeof publicBookingSchema>;

export type FieldError = { field: string; message: { el: string; en: string } };

const fe = (field: string, el: string, en: string): FieldError => ({ field, message: { el, en } });

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export interface CleanContact {
  firstName: string;
  lastName: string;
  email: string;
  /** "+30 6900000000" */
  phone: string;
  birthDate: string;
  flightNumber: string | null;
  notes: string | null;
}

/**
 * Έλεγχος + καθάρισμα των στοιχείων του πελάτη. `needsFlight` = το σημείο
 * παραλαβής ή επιστροφής ζητά πτήση (askFlightNumber ή αεροδρόμιο).
 */
export function validateContact(
  input: Pick<PublicBookingInput, "firstName" | "lastName" | "email" | "phoneCountry" | "phone" | "birthDate" | "flightNumber" | "notes" | "acceptTerms">,
  opts: { needsFlight: boolean; pickupDate: string }
): { ok: true; contact: CleanContact } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const firstName = cleanText(input.firstName, NAME_MAX);
  const lastName = cleanText(input.lastName, NAME_MAX);
  if (firstName.length < 2) errors.push(fe("firstName", "Γράψτε το όνομά σας.", "Enter your first name."));
  if (lastName.length < 2) errors.push(fe("lastName", "Γράψτε το επώνυμό σας.", "Enter your last name."));

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > EMAIL_MAX) {
    errors.push(fe("email", "Μη έγκυρο email.", "Invalid email address."));
  }

  const digits = phoneDigits(input.phone);
  if (!PHONE_CODES.has(input.phoneCountry)) errors.push(fe("phone", "Διαλέξτε κωδικό χώρας.", "Choose a country code."));
  else if (!/^\d{6,14}$/.test(digits)) errors.push(fe("phone", "Μη έγκυρος αριθμός τηλεφώνου.", "Invalid phone number."));

  const birth = /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) ? input.birthDate : "";
  const age = birth ? ageAt(birth, opts.pickupDate) : null;
  if (age === null || age < 16 || age > 110) {
    errors.push(fe("birthDate", "Μη έγκυρη ημερομηνία γέννησης.", "Invalid date of birth."));
  }

  const flight = cleanText(input.flightNumber ?? "", 12).toUpperCase().replace(/\s+/g, " ");
  if (flight && !FLIGHT_RE.test(flight)) {
    errors.push(fe("flightNumber", "Μη έγκυρος αριθμός πτήσης (π.χ. A3 123).", "Invalid flight number (e.g. A3 123)."));
  }

  const notes = cleanText(input.notes ?? "", NOTES_MAX);
  if (!input.acceptTerms) errors.push(fe("acceptTerms", "Πρέπει να αποδεχτείτε τους όρους.", "You must accept the terms."));

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    contact: {
      firstName,
      lastName,
      email,
      phone: `${input.phoneCountry} ${digits}`,
      birthDate: birth,
      flightNumber: opts.needsFlight && flight ? flight : null,
      notes: notes || null,
    },
  };
}

/** Το honeypot γεμάτο → bot. Ο server απαντά «επιτυχία» χωρίς να γράψει τίποτα. */
export const isBot = (input: Pick<PublicBookingInput, "website">): boolean => (input.website ?? "").trim() !== "";

/* ─────────────────────────────────────────────
   Ηλικία vs κλίμακα της αναζήτησης
   ───────────────────────────────────────────── */

export const bandOf = (age: number | null, bands: SearchAgeBand[]): SearchAgeBand | null =>
  age === null ? null : bands.find((b) => age >= b.minAge && age <= b.maxAge) ?? null;

/**
 * Η ημερομηνία γέννησης δίνει ηλικία στην ΙΔΙΑ κλίμακα με την αναζήτηση;
 * (Χωρίς κλίμακες στην εταιρία → πάντα ναι.) Αν όχι: ποια ηλικία να μπει
 * στην αναζήτηση για σωστή τιμή.
 */
export function checkAgeBand(
  birthDate: string,
  pickupDate: string,
  searchAge: number | null,
  bands: SearchAgeBand[]
): { ok: true; age: number | null } | { ok: false; actualAge: number | null; allowed: boolean } {
  const age = ageAt(birthDate, pickupDate);
  if (bands.length === 0) return { ok: true, age };
  const actual = bandOf(age, bands);
  const chosen =
    searchAge === null ? bands.find((b) => b.isDefault) ?? null : bandOf(searchAge, bands);
  if (actual && chosen && actual.minAge === chosen.minAge && actual.maxAge === chosen.maxAge && actual.allowed) {
    return { ok: true, age };
  }
  return { ok: false, actualAge: age, allowed: !!actual?.allowed };
}

/* ─────────────────────────────────────────────
   Κωδικός κράτησης
   ───────────────────────────────────────────── */

/**
 * "K7M2-X9PQ" — ΙΔΙΟ αλφάβητο και μορφή με τον κωδικό τιμολογίου
 * (invoiceCode.ts· η δημιουργία, με crypto.randomInt, γίνεται μόνο στον server:
 * bookingSubmit.ts → generateInvoiceCode). Εδώ μόνο ο έλεγχος μορφής, που
 * τρέχει και στον browser.
 */
export const BOOKING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOOKING_CODE_RE = new RegExp(`^[${BOOKING_CODE_ALPHABET}]{4}-[${BOOKING_CODE_ALPHABET}]{4}$`);
export const isBookingCode = (s: unknown): s is string => typeof s === "string" && BOOKING_CODE_RE.test(s);

/** Ο κωδικός όπως τον πληκτρολογεί άνθρωπος (πεζά, χωρίς παύλα) → κανονική μορφή. */
export function normalizeBookingCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== 8) return null;
  const code = `${s.slice(0, 4)}-${s.slice(4)}`;
  return isBookingCode(code) ? code : null;
}

/* ─────────────────────────────────────────────
   Κείμενα ανά τρόπο κράτησης
   ───────────────────────────────────────────── */

export type RentalModeValue = "BOOKING" | "REQUEST";

/**
 * Η κατάσταση είναι ΠΑΝΤΑ PENDING (και στους δύο τρόπους): την επιβεβαιώνει
 * η εταιρία. Διαφέρει μόνο το κείμενο προς τον πελάτη.
 */
export const SITE_BOOKING_STATUS = "PENDING" as const;

export function bookingTexts(mode: RentalModeValue) {
  return mode === "REQUEST"
    ? {
        submit: { el: "Αποστολή αιτήματος", en: "Send request" },
        done: { el: "Το αίτημά σας στάλθηκε", en: "Your request has been sent" },
        next: {
          el: "Η εταιρία θα ελέγξει τη διαθεσιμότητα και θα σας επιβεβαιώσει.",
          en: "The company will check availability and confirm with you.",
        },
      }
    : {
        submit: { el: "Υποβολή κράτησης", en: "Submit booking" },
        done: { el: "Η κράτησή σας καταχωρήθηκε", en: "Your booking has been received" },
        next: {
          el: "Η εταιρία θα την επιβεβαιώσει σύντομα.",
          en: "The company will confirm it shortly.",
        },
      };
}

/* ─────────────────────────────────────────────
   Σελίδα επιβεβαίωσης — ΜΟΝΟ δημόσια πεδία
   ───────────────────────────────────────────── */

/** "giannis@gmail.com" → "g*****@gmail.com" */
export function maskEmail(email: string | null | undefined): string {
  const m = /^([^@]+)@(.+)$/.exec(email ?? "");
  if (!m) return "";
  const user = m[1];
  return `${user[0]}${"*".repeat(Math.max(3, user.length - 1))}@${m[2]}`;
}

export interface ConfirmationSource {
  publicCode: string;
  status: string;
  pickupDate: Date;
  pickupTime: string | null;
  returnDate: Date;
  returnTime: string | null;
  pickupLocation: string | null;
  returnLocation: string | null;
  priceQuote: unknown;
  total: unknown;
  customer: { firstName: string; email: string | null };
  groupName: string;
  groupSimilar: string | null;
  photoUrl: string | null;
  cancelReasonCode?: string | null;
  cancelNote?: string | null;
}

export interface ConfirmationDTO {
  code: string;
  status: string;
  firstName: string;
  maskedEmail: string;
  groupName: string;
  groupSimilar: string | null;
  photoUrl: string | null;
  from: string;
  to: string;
  pickupLocation: string | null;
  returnLocation: string | null;
  lines: { label: { el?: string; en?: string }; qty: number; totalCents: number; kind: string }[];
  totalCents: number;
  listTotalCents: number | null;
  vatCents: number | null;
  depositCents: number | null;
  excessCents: number | null;
  /** ΜΟΝΟ σε ακυρωμένη: ο λόγος (κωδικός λίστας) και το σημείωμα της εταιρίας. */
  cancelReasonCode: string | null;
  cancelNote: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Από την κράτηση στη σελίδα επιβεβαίωσης. Η τιμή ΑΠΟ το αποθηκευμένο
 * priceQuote (όχι νέος υπολογισμός). Ποτέ τηλέφωνο, ηλικία, σχόλια, πτήση.
 */
export function toConfirmationDTO(b: ConfirmationSource): ConfirmationDTO {
  const q = (b.priceQuote && typeof b.priceQuote === "object" ? b.priceQuote : {}) as {
    quote?: { lines?: QuoteLine[]; listTotalCents?: number; vatCents?: number; depositCents?: number | null; excessCents?: number | null };
    totalCents?: number;
  };
  const lines = Array.isArray(q.quote?.lines) ? q.quote!.lines : [];
  return {
    code: b.publicCode,
    status: b.status,
    firstName: b.customer.firstName,
    maskedEmail: maskEmail(b.customer.email),
    groupName: b.groupName,
    groupSimilar: b.groupSimilar,
    photoUrl: b.photoUrl,
    from: `${iso(b.pickupDate)}T${b.pickupTime ?? "10:00"}`,
    to: `${iso(b.returnDate)}T${b.returnTime ?? "10:00"}`,
    pickupLocation: b.pickupLocation,
    returnLocation: b.returnLocation,
    lines: lines.map((l) => ({ label: l.label, qty: l.qty, totalCents: l.totalCents, kind: l.kind })),
    totalCents: typeof q.totalCents === "number" ? q.totalCents : Math.round(Number(b.total) * 100),
    listTotalCents: q.quote?.listTotalCents ?? null,
    vatCents: q.quote?.vatCents ?? null,
    depositCents: q.quote?.depositCents ?? null,
    excessCents: q.quote?.excessCents ?? null,
    cancelReasonCode: b.status === "CANCELLED" ? b.cancelReasonCode ?? null : null,
    cancelNote: b.status === "CANCELLED" ? b.cancelNote ?? null : null,
  };
}
