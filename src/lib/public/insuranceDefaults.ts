// src/lib/public/insuranceDefaults.ts
// Προεπιλεγμένη ασφάλεια — καθαρή λογική (χωρίς βάση), για server, UI και tests.
//
// Κανόνας: το πολύ ΜΙΑ προεπιλεγμένη ασφάλεια (type INSURANCE) ανά εταιρία και
// ανά τύπο οχήματος. Κενό vehicleTypes = ισχύει για ΟΛΟΥΣ τους τύπους, άρα
// «συγκρούεται» με κάθε άλλη προεπιλογή.

export interface DefaultCandidate {
  id: string;
  type: string;
  isDefault: boolean;
  isActive?: boolean;
  vehicleTypes: string[];
}

/** Καλύπτουν κοινό τύπο οχήματος; (κενό = όλοι) */
export function typesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((t) => b.includes(t));
}

/**
 * Ποιες ΑΛΛΕΣ προεπιλεγμένες ασφάλειες πρέπει να πάψουν να είναι προεπιλογή
 * όταν η `chosen` γίνεται (ή μένει) προεπιλογή. Ο server τις κάνει false στην
 * ίδια transaction — η τελευταία επιλογή κερδίζει.
 */
export function defaultsToClear(chosen: DefaultCandidate, others: DefaultCandidate[]): string[] {
  if (chosen.type !== "INSURANCE" || !chosen.isDefault) return [];
  return others
    .filter(
      (o) => o.id !== chosen.id && o.type === "INSURANCE" && o.isDefault && typesOverlap(o.vehicleTypes, chosen.vehicleTypes)
    )
    .map((o) => o.id);
}

/** Η προεπιλεγμένη (ενεργή) ασφάλεια για έναν τύπο οχήματος — ή null. */
export function defaultInsuranceFor<T extends DefaultCandidate>(list: T[], vehicleType: string): T | null {
  return (
    list.find(
      (e) =>
        e.type === "INSURANCE" &&
        e.isDefault &&
        e.isActive !== false &&
        (e.vehicleTypes.length === 0 || e.vehicleTypes.includes(vehicleType))
    ) ?? null
  );
}
