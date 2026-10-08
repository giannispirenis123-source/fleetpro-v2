// src/lib/contractLocations.ts
// Σημεία παραλαβής/επιστροφής για το combobox του συμβολαίου — καθαρή
// λογική, χωρίς runtime imports (client + server + tests).
//
// Τα σημεία μιας εταιρίας ΔΕΝ έχουν δικό τους πίνακα: είναι τα βασικά
// σημεία + ό,τι έχει ήδη γραφτεί σε συμβόλαια της ίδιας εταιρίας
// (contracts.pickupLocation / returnLocation). Ένα νέο σημείο που
// αποθηκεύεται σε συμβόλαιο εμφανίζεται έτσι στη λίστα την επόμενη φορά.

/** Τα βασικά σημεία — πάντα στη λίστα, πρώτα. */
export const DEFAULT_LOCATIONS = [
  "Αεροδρόμιο Χανίων",
  "Λιμάνι Σούδας",
  "Κέντρο Χανίων",
  "Κάτω Δαράτσο",
  "Ξενοδοχείο πελάτη",
] as const;

/** Μέγιστο πλήθος σημείων από τα συμβόλαια (τα πιο συχνά). */
export const MAX_USED_LOCATIONS = 50;

/** Κλειδί σύγκρισης: χωρίς κενά άκρων/διπλά κενά, πεζά, χωρίς τόνους. */
export function locationKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Βασικά σημεία + σημεία των συμβολαίων (πιο συχνά πρώτα), χωρίς
 * διπλότυπα (ίδιο κλειδί = ίδιο σημείο, κρατιέται η πρώτη γραφή) και κενά.
 */
export function mergeLocations(used: { value: string | null; count: number }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: string) => {
    const clean = v.replace(/\s+/g, " ").trim();
    const key = locationKey(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  DEFAULT_LOCATIONS.forEach(add);
  [...used]
    .filter((u) => u.value)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_USED_LOCATIONS)
    .forEach((u) => add(u.value as string));
  return out;
}
