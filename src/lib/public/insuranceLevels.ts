// src/lib/public/insuranceLevels.ts
// «Επίπεδα ασφάλειας» ανά εταιρία — καθαρή λογική (χωρίς βάση).
//
// ΑΠΟΦΑΣΗ: τα επίπεδα ΕΙΝΑΙ οι γραμμές του υπάρχοντος πίνακα extras με
// type = 'INSURANCE' (όχι νέος πίνακας → κανένα διπλό σύστημα). Ό,τι ήθελε το
// επίπεδο υπήρχε ήδη (όνομα/περιγραφή ανά γλώσσα, τιμή, ανά ημέρα/ενοικίαση,
// ταβάνι, απαλλαγή, τύποι οχημάτων, ενεργό, σειρά)· το SQL 25 πρόσθεσε μόνο
// τις καλύψεις (coveragesI18n). Τα ποσά στη βάση μένουν σε € (Decimal)· εδώ
// και στο API σε cents (money.ts).
//
// · Καμία «προεπιλογή»: το isDefault αγνοείται για πάντα (SQL 25).
// · Διαγραφή επιπέδου που χρησιμοποιήθηκε σε κράτηση = ΑΠΕΝΕΡΓΟΠΟΙΗΣΗ (οι
//   αποθηκευμένες αναλύσεις των κρατήσεων μένουν ανέπαφες).

import { z } from "zod";
import type { Extra } from "@prisma/client";
import { toCents, toCentsOrNull } from "./money";
import { COVERAGE_LEN, COVERAGES_MAX, readLocalized, readLocalizedList, type LocalizedText } from "./text";
import { VEHICLE_TYPES } from "./pricing";

export interface InsuranceLevelDTO {
  id: string;
  nameI18n: LocalizedText;
  descriptionI18n: LocalizedText;
  coveragesI18n: LocalizedText[];
  priceCents: number;
  chargeType: "PER_DAY" | "ONE_OFF";
  maxTotalCents: number | null;
  /** Συμμετοχή σε ζημιά — ΜΟΝΟ ενημερωτική, δεν υπολογίζεται πουθενά. */
  excessCents: number | null;
  vehicleTypes: string[];
  isActive: boolean;
  sortOrder: number;
}

export function toInsuranceLevelDTO(e: Extra): InsuranceLevelDTO {
  const name = readLocalized(e.nameI18n);
  return {
    id: e.id,
    nameI18n: name.el ? name : { ...name, el: e.name },
    descriptionI18n: readLocalized(e.descriptionI18n),
    coveragesI18n: readLocalizedList(e.coveragesI18n),
    priceCents: toCents(e.price),
    chargeType: e.chargeType,
    maxTotalCents: toCentsOrNull(e.maxTotal),
    excessCents: toCentsOrNull(e.excess),
    vehicleTypes: e.vehicleTypes,
    isActive: e.isActive,
    sortOrder: e.sortOrder,
  };
}

/** Κείμενο ανά γλώσσα (ίδιος κανόνας με το resources.ts, χωρίς τις εξαρτήσεις του server). */
const i18nField = (max: number, required = false, label = "Το ελληνικό κείμενο") =>
  z
    .record(z.string().regex(/^[a-z]{2}$/), z.string().max(max, `Έως ${max} χαρακτήρες`))
    .default({})
    .transform((t) => readLocalized(t, max))
    .refine((t) => !required || !!t.el, `${label} είναι υποχρεωτικό`);

const cents = z.number().int("Μη έγκυρο ποσό").min(0, "Το ποσό δεν μπορεί να είναι αρνητικό").max(10_000_000);

/** Μία κάλυψη: ΕΛ ή EN (τουλάχιστον το ένα), μία γραμμή. */
const coverage = z
  .record(z.string().regex(/^[a-z]{2}$/), z.string().max(COVERAGE_LEN, `Έως ${COVERAGE_LEN} χαρακτήρες ανά κάλυψη`))
  .transform((t) => readLocalized(t, COVERAGE_LEN));

export const insuranceLevelSchema = z.object({
  nameI18n: i18nField(80, true, "Το όνομα (ΕΛ)"),
  descriptionI18n: i18nField(300),
  coveragesI18n: z
    .array(coverage)
    .max(COVERAGES_MAX, `Έως ${COVERAGES_MAX} καλύψεις`)
    .default([])
    // Κενές γραμμές (π.χ. «προσθήκη» χωρίς κείμενο) απλώς φεύγουν.
    .transform((l) => l.filter((c) => Object.keys(c).length > 0)),
  priceCents: cents,
  chargeType: z.enum(["PER_DAY", "ONE_OFF"]),
  maxTotalCents: cents.nullable().default(null),
  excessCents: cents.nullable().default(null),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).max(3).default([]).transform((l) => Array.from(new Set(l))),
  isActive: z.boolean().default(true),
});

export type InsuranceLevelInput = z.infer<typeof insuranceLevelSchema>;

/** Διαγραφή: σβήσιμο ΜΟΝΟ αν δεν το χρησιμοποίησε καμία κράτηση· αλλιώς ανενεργό. */
export const deleteActionFor = (usedInBookings: number): "delete" | "deactivate" => (usedInBookings > 0 ? "deactivate" : "delete");

/**
 * Πάνω/κάτω: νέα σειρά (0, 1, 2…) για ΟΛΑ τα επίπεδα, με το `id` μετακινημένο
 * μία θέση. Επιστρέφει μόνο όσα αλλάζουν. Άκρη της λίστας → καμία αλλαγή.
 */
export function moveLevel(
  levels: { id: string; sortOrder: number }[],
  id: string,
  dir: "up" | "down"
): { id: string; sortOrder: number }[] {
  const ordered = [...levels].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const i = ordered.findIndex((l) => l.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ordered.length) return [];
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  return ordered.flatMap((l, idx) => (l.sortOrder === idx ? [] : [{ id: l.id, sortOrder: idx }]));
}
