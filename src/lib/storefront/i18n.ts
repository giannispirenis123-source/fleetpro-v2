// src/lib/storefront/i18n.ts
// Σταθερά κείμενα της ΔΗΜΟΣΙΑΣ σελίδας (/s/<slug>) — ΜΙΑ κεντρική δομή,
// ξεχωριστή από τα λεξικά του dashboard (που είναι μόνο el/en ανά χρήστη).
//
// Νέα γλώσσα (π.χ. γαλλικά) = νέο λεξικό εδώ (Partial — ό,τι λείπει πέφτει
// στα αγγλικά) + ο κωδικός της στο supportedLanguages της εταιρίας.
// Καμία αλλαγή στη βάση: το περιεχόμενο της εταιρίας αποθηκεύεται ανά
// κωδικό γλώσσας μέσα στο storefrontSettings (JSON).

const en = {
  langName: "English",
  ourFleet: "Our fleet",
  noVehicles: "No vehicles are listed at the moment. Please contact us for availability.",
  fromPerDay: "from {price} / day",
  vatIncluded: "VAT included",
  seats: "{n} seats",
  seatsLabel: "Seats",
  doorsLabel: "Doors",
  ac: "Air conditioning",
  contact: "Contact",
  contactUs: "Contact us",
  contactText: "Ask us about availability and prices for your dates.",
  call: "Call",
  email: "Email",
  back: "All vehicles",
  details: "Details",
  photos: "Photos",
  noPhoto: "No photo",
  language: "Language",
  category: "Category",
  fuel: "Fuel",
  transmission: "Gearbox",
  year: "Year",
  payOnPickup: "Pay on pickup",
  bookingRequest: "Bookings are confirmed by the company.",
  poweredBy: "Powered by FleetPro",
  notFoundTitle: "Page not found",
  categories: {
    A: "Mini", B: "Economy", C: "Compact", SUV: "SUV", PREMIUM: "Premium",
    LUXURY: "Luxury", VAN: "Van", MOTORCYCLE: "Motorbike",
  } as Record<string, string>,
  fuels: {
    PETROL: "Petrol", DIESEL: "Diesel", HYBRID: "Hybrid", ELECTRIC: "Electric", LPG: "LPG",
  } as Record<string, string>,
  transmissions: { Manual: "Manual", Automatic: "Automatic" } as Record<string, string>,
};

export type StorefrontDictionary = typeof en;

const el: Partial<StorefrontDictionary> = {
  langName: "Ελληνικά",
  ourFleet: "Ο στόλος μας",
  noVehicles: "Δεν υπάρχουν διαθέσιμα οχήματα αυτή τη στιγμή. Επικοινωνήστε μαζί μας.",
  fromPerDay: "από {price} / ημέρα",
  vatIncluded: "με ΦΠΑ",
  seats: "{n} θέσεις",
  seatsLabel: "Θέσεις",
  doorsLabel: "Πόρτες",
  ac: "Κλιματισμός",
  contact: "Επικοινωνία",
  contactUs: "Επικοινωνήστε μαζί μας",
  contactText: "Ρωτήστε μας για διαθεσιμότητα και τιμές για τις ημερομηνίες σας.",
  call: "Τηλέφωνο",
  email: "Email",
  back: "Όλα τα οχήματα",
  details: "Λεπτομέρειες",
  photos: "Φωτογραφίες",
  noPhoto: "Χωρίς φωτογραφία",
  language: "Γλώσσα",
  category: "Κατηγορία",
  fuel: "Καύσιμο",
  transmission: "Κιβώτιο",
  year: "Έτος",
  payOnPickup: "Πληρωμή κατά την παραλαβή",
  bookingRequest: "Οι κρατήσεις επιβεβαιώνονται από την εταιρία.",
  poweredBy: "Με την τεχνολογία του FleetPro",
  notFoundTitle: "Η σελίδα δεν βρέθηκε",
  categories: {
    A: "Mini", B: "Οικονομικό", C: "Compact", SUV: "SUV", PREMIUM: "Premium",
    LUXURY: "Πολυτελές", VAN: "Van", MOTORCYCLE: "Μηχανή",
  },
  fuels: {
    PETROL: "Βενζίνη", DIESEL: "Diesel", HYBRID: "Υβριδικό", ELECTRIC: "Ηλεκτρικό", LPG: "Υγραέριο",
  },
  transmissions: { Manual: "Χειροκίνητο", Automatic: "Αυτόματο" },
};

const DICTIONARIES: Record<string, Partial<StorefrontDictionary>> = { el, en };

/** Οι γλώσσες για τις οποίες ΥΠΑΡΧΕΙ λεξικό — μόνο αυτές επιτρέπονται στο site. */
export const STOREFRONT_LANGUAGES: readonly string[] = Object.keys(DICTIONARIES);

export const isStorefrontLanguage = (code: unknown): code is string =>
  typeof code === "string" && STOREFRONT_LANGUAGES.includes(code);

/** Το λεξικό μιας γλώσσας, με fallback ανά κλειδί στα αγγλικά. */
export function storefrontDictionary(lang: string): StorefrontDictionary {
  const d = DICTIONARIES[lang] ?? {};
  return {
    ...en,
    ...d,
    categories: { ...en.categories, ...d.categories },
    fuels: { ...en.fuels, ...d.fuels },
    transmissions: { ...en.transmissions, ...d.transmissions },
  };
}

/** Απλή αντικατάσταση {name} σε κείμενο του λεξικού. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** Ποσό σε € με τη μορφή της γλώσσας (π.χ. «35 €» / «€35»). */
export function formatEuro(amount: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} €`;
  }
}
