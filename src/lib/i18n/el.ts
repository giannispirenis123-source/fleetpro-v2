// src/lib/i18n/el.ts
// Ελληνικό λεξικό — η πηγή αλήθειας για τη δομή των κλειδιών.
// Το en.ts τυποποιείται πάνω σε αυτό, οπότε κάθε κλειδί που λείπει
// από τα Αγγλικά γίνεται σφάλμα στο typecheck.

export const el = {
  common: {
    appName: "FleetPro",
    language: "Γλώσσα",
    greek: "Ελληνικά",
    english: "Αγγλικά",
    logout: "Αποσύνδεση",
    menu: "Μενού",
    close: "Κλείσιμο",
    comingSoon: "σύντομα",
    myCompany: "Η εταιρία μου",
  },

  auth: {
    heroTitleLine1: "Διαχείριση στόλου",
    heroTitleLine2: "χωρίς όρια",
    heroSubtitle:
      "Η πλατφόρμα που χρειάζεται κάθε εταιρία ενοικίασης οχημάτων για να λειτουργεί αποδοτικά και επαγγελματικά.",
    feature1: "Multi-tenant αρχιτεκτονική",
    feature2: "Ηλεκτρονικά συμβόλαια & υπογραφές",
    feature3: "Σύστημα εκπτώσεων & προσφορών",
    feature4: "Αναφορές & στατιστικά σε πραγματικό χρόνο",
    welcome: "Καλώς ήρθατε",
    signInPrompt: "Συνδεθείτε με τον λογαριασμό σας",
    email: "Email",
    emailPlaceholder: "email@company.gr",
    password: "Κωδικός Πρόσβασης",
    signIn: "Σύνδεση",
    noAccount: "Δεν έχετε λογαριασμό;",
    contactUs: "Επικοινωνήστε μαζί μας",
    demoAccounts: "Demo λογαριασμοί",
    errorMissingFields: "Συμπληρώστε email και κωδικό",
    errorGeneric: "Σφάλμα σύνδεσης. Δοκιμάστε ξανά.",
    errorDefault: "Σφάλμα σύνδεσης",
    showPassword: "Εμφάνιση κωδικού",
    hidePassword: "Απόκρυψη κωδικού",
  },

  sidebar: {
    overview: "Πίνακας",
    bookings: "Κρατήσεις",
    calendar: "Ημερολόγιο",
    fleet: "Στόλος",
    customers: "Πελάτες",
    contracts: "Συμβόλαια",
    invoices: "Τιμολόγια",
    service: "Service & Ζημιές",
    reports: "Αναφορές",
    finance: "Οικονομικά",
    users: "Χρήστες",
    settings: "Ρυθμίσεις",
    roleCompanyAdmin: "Διαχειριστής",
    roleStaff: "Προσωπικό",
    rolePartner: "Συνεργάτης",
  },

  dashboard: {
    greeting: "Καλημέρα",
    subtitle: "Ορίστε μια γρήγορη εικόνα της επιχείρησής σου σήμερα.",
    availableVehicles: "Διαθέσιμα οχήματα",
    rentedVehicles: "Ενοικιασμένα",
    inMaintenance: "Σε συντήρηση",
    monthRevenue: "Έσοδα μήνα",
    fleetOccupancy: "Πληρότητα στόλου",
    activeBookings: "Ενεργές κρατήσεις",
    alerts: "Ειδοποιήσεις",
    alertServiceOne: "όχημα χρειάζεται service (≤30 ημέρες)",
    alertServiceMany: "οχήματα χρειάζονται service (≤30 ημέρες)",
    alertInsurance: "ασφάλ. λήγει σύντομα (≤60 ημέρες)",
    alertMot: "ΚΤΕΟ λήγει σύντομα (≤60 ημέρες)",
    alertUnsignedContracts: "ανυπόγραφα συμβόλαια",
    allClear: "Όλα εντάξει — καμία εκκρεμότητα αυτή τη στιγμή.",
    recentBookings: "Πρόσφατες κρατήσεις",
    noBookings: "Δεν υπάρχουν κρατήσεις ακόμα.",
    pendingItems: "Εκκρεμότητες",
    pendingDamages: "Ζημιές σε εκκρεμότητα",
    unpaidInvoices: "Απλήρωτα τιμολόγια",
    totalFleet: "Σύνολο στόλου",
  },

  status: {
    PENDING: "Εκκρεμεί",
    CONFIRMED: "Επιβεβαιωμένη",
    ACTIVE: "Ενεργή",
    COMPLETED: "Ολοκληρώθηκε",
    CANCELLED: "Ακυρώθηκε",
  },
};

export type Dictionary = typeof el;
