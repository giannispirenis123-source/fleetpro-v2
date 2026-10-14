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
  // ── Αρχική / αναζήτηση (PR 2) ──
  heroTitle: "Car rental · {name}",
  searchTitle: "Find your vehicle",
  pickupLocation: "Pick-up location",
  dropoffLocation: "Drop-off location",
  differentDropoff: "Return to a different location",
  pickupDate: "Pick-up",
  dropoffDate: "Drop-off",
  pickupTime: "Pick-up time",
  dropoffTime: "Drop-off time",
  dates: "Dates",
  chooseDates: "Choose dates",
  choosePickupDay: "Choose the pick-up day",
  chooseDropoffDay: "Choose the drop-off day",
  done: "Done",
  close: "Close",
  driverAge: "Driver age",
  ageYears: "{label} years",
  searchButton: "Search",
  searching: "Searching…",
  checkSearch: "Please check your search",
  timesNote: "Times are local time in Greece.",
  ourVehicles: "Our vehicles",
  resultsTitle: "Available vehicles",
  resultsCount: "{n} options",
  resultsCountOne: "1 option",
  vehicleTypes: "Vehicle type",
  tabAll: "All",
  tabTypes: { car: "Cars", moto: "Motorbikes", atv: "ATV" } as Record<string, string>,
  sortLabel: "Sort",
  sortAsc: "Cheapest first",
  sortDesc: "Price ↓",
  orSimilar: "{name} or similar",
  daysTotal: "Total for {n} days",
  daysTotalOne: "Total for 1 day",
  perDay: "{price} / day",
  wasPrice: "Was {price}",
  onlyLeft: "Only {n} left",
  onlyLeftOne: "Only 1 left",
  unavailable: "Not available for these dates",
  bookNow: "Book",
  requestBooking: "Request booking",
  seePrices: "See prices",
  noResultsTitle: "No vehicles for these dates",
  noResultsText: "Try different dates or times, or contact us — we will gladly help.",
  editSearch: "Change search",
  doorsN: "{n} doors",
  bagsN: "{n} suitcases",
  smallBagsN: "{n} small bags",
  engineCc: "{n} cc",
  acShort: "A/C",
  // ── Περίληψη κράτησης ──
  bookTitle: "Your booking",
  requestTitle: "Your booking request",
  pickupAt: "Pick-up",
  dropoffAt: "Drop-off",
  sameLocation: "Same as pick-up",
  priceBreakdown: "Price breakdown",
  total: "Total",
  vatIncludedAmount: "VAT included: {amount}",
  deposit: "Deposit",
  excess: "Excess",
  bookingSoon: "Online booking is coming soon. To book this vehicle, contact us with the details above.",
  requestSoon: "Online requests are coming soon. Send us your request with the details above and we will confirm availability.",
  whatsapp: "WhatsApp",
  backToResults: "Back to results",
  notBookable: "This vehicle can no longer be booked for these dates.",
  homeLabel: "Home",
  skipToContent: "Skip to content",
  /** Δευτέρα πρώτη. Δικά μας κείμενα (όχι Intl) → ίδια σε server και browser. */
  weekdaysShort: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as string[],
  monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as string[],
  months: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ] as string[],
  categories: {
    A: "Mini", B: "Economy", C: "Compact", SUV: "SUV", PREMIUM: "Premium",
    LUXURY: "Luxury", VAN: "Van", MOTORCYCLE: "Motorbike",
  } as Record<string, string>,
  fuels: {
    PETROL: "Petrol", DIESEL: "Diesel", HYBRID: "Hybrid", ELECTRIC: "Electric", LPG: "LPG",
  } as Record<string, string>,
  transmissions: { Manual: "Manual", Automatic: "Automatic", manual: "Manual", automatic: "Automatic" } as Record<string, string>,
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
  heroTitle: "Ενοικίαση οχημάτων · {name}",
  searchTitle: "Βρείτε το όχημά σας",
  pickupLocation: "Σημείο παραλαβής",
  dropoffLocation: "Σημείο επιστροφής",
  differentDropoff: "Επιστροφή σε άλλη τοποθεσία",
  pickupDate: "Παραλαβή",
  dropoffDate: "Επιστροφή",
  pickupTime: "Ώρα παραλαβής",
  dropoffTime: "Ώρα επιστροφής",
  dates: "Ημερομηνίες",
  chooseDates: "Επιλογή ημερομηνιών",
  choosePickupDay: "Διαλέξτε ημέρα παραλαβής",
  chooseDropoffDay: "Διαλέξτε ημέρα επιστροφής",
  done: "Εντάξει",
  close: "Κλείσιμο",
  driverAge: "Ηλικία οδηγού",
  ageYears: "{label} ετών",
  searchButton: "Αναζήτηση",
  searching: "Αναζήτηση…",
  checkSearch: "Ελέγξτε την αναζήτηση",
  timesNote: "Οι ώρες είναι ώρα Ελλάδας.",
  ourVehicles: "Τα οχήματά μας",
  resultsTitle: "Διαθέσιμα οχήματα",
  resultsCount: "{n} επιλογές",
  resultsCountOne: "1 επιλογή",
  vehicleTypes: "Τύπος οχήματος",
  tabAll: "Όλα",
  tabTypes: { car: "Αυτοκίνητα", moto: "Μηχανές", atv: "ATV" },
  sortLabel: "Ταξινόμηση",
  sortAsc: "Φθηνότερα πρώτα",
  sortDesc: "Τιμή ↓",
  orSimilar: "{name} ή παρόμοιο",
  daysTotal: "Σύνολο για {n} ημέρες",
  daysTotalOne: "Σύνολο για 1 ημέρα",
  perDay: "{price} / ημέρα",
  wasPrice: "Πριν {price}",
  onlyLeft: "Μόνο {n} διαθέσιμα",
  onlyLeftOne: "Μόνο 1 διαθέσιμο",
  unavailable: "Μη διαθέσιμο για αυτές τις ημερομηνίες",
  bookNow: "Κράτηση",
  requestBooking: "Αίτημα κράτησης",
  seePrices: "Δείτε τιμές",
  noResultsTitle: "Δεν βρέθηκαν οχήματα για αυτές τις ημερομηνίες",
  noResultsText: "Δοκιμάστε άλλες ημερομηνίες ή ώρες, ή επικοινωνήστε μαζί μας — θα βοηθήσουμε ευχαρίστως.",
  editSearch: "Αλλαγή αναζήτησης",
  doorsN: "{n} πόρτες",
  bagsN: "{n} βαλίτσες",
  smallBagsN: "{n} μικρές τσάντες",
  engineCc: "{n} cc",
  acShort: "A/C",
  bookTitle: "Η κράτησή σας",
  requestTitle: "Το αίτημα κράτησής σας",
  pickupAt: "Παραλαβή",
  dropoffAt: "Επιστροφή",
  sameLocation: "Ίδιο με την παραλαβή",
  priceBreakdown: "Ανάλυση τιμής",
  total: "Σύνολο",
  vatIncludedAmount: "Περιλαμβάνεται ΦΠΑ: {amount}",
  deposit: "Εγγύηση",
  excess: "Απαλλαγή",
  bookingSoon: "Η online κράτηση έρχεται σύντομα. Για να κλείσετε αυτό το όχημα, επικοινωνήστε μαζί μας με τα παραπάνω στοιχεία.",
  requestSoon: "Το online αίτημα έρχεται σύντομα. Στείλτε μας το αίτημά σας με τα παραπάνω στοιχεία και θα σας επιβεβαιώσουμε τη διαθεσιμότητα.",
  whatsapp: "WhatsApp",
  backToResults: "Πίσω στα αποτελέσματα",
  notBookable: "Το όχημα δεν μπορεί πλέον να κλειστεί για αυτές τις ημερομηνίες.",
  homeLabel: "Αρχική",
  skipToContent: "Μετάβαση στο περιεχόμενο",
  weekdaysShort: ["Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ", "Κυρ"],
  monthsShort: ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"],
  months: [
    "Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος",
    "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος",
  ],
  categories: {
    A: "Mini", B: "Οικονομικό", C: "Compact", SUV: "SUV", PREMIUM: "Premium",
    LUXURY: "Πολυτελές", VAN: "Van", MOTORCYCLE: "Μηχανή",
  },
  fuels: {
    PETROL: "Βενζίνη", DIESEL: "Diesel", HYBRID: "Υβριδικό", ELECTRIC: "Ηλεκτρικό", LPG: "Υγραέριο",
  },
  transmissions: { Manual: "Χειροκίνητο", Automatic: "Αυτόματο", manual: "Χειροκίνητο", automatic: "Αυτόματο" },
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
    tabTypes: { ...en.tabTypes, ...d.tabTypes },
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

/** "YYYY-MM-DD" → «Παρ 16 Οκτ» / «Fri 16 Oct» — χωρίς Intl, ίδιο σε server και browser. */
export function formatDay(date: string, d: Pick<StorefrontDictionary, "weekdaysShort" | "monthsShort">): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${d.weekdaysShort[(t.getUTCDay() + 6) % 7]} ${t.getUTCDate()} ${d.monthsShort[t.getUTCMonth()]}`;
}

/** "YYYY-MM-DDTHH:mm" → «Παρ 16 Οκτ, 10:00». */
export const formatDateTime = (value: string, d: Pick<StorefrontDictionary, "weekdaysShort" | "monthsShort">): string =>
  `${formatDay(value.slice(0, 10), d)}, ${value.slice(11, 16)}`;
