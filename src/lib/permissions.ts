// src/lib/permissions.ts
// Το μητρώο δικαιωμάτων — ΜΙΑ πηγή αλήθειας.
//
// Κάθε δικαίωμα ορίζεται ΜΟΝΟ εδώ: το κλειδί, η ενότητα στην οποία ανήκει
// και οι ετικέτες στις δύο γλώσσες. Το API, η σελίδα Χρηστών και το
// sidebar διαβάζουν από εδώ, ώστε να μη χρειάζεται να θυμάται κανείς να
// ενημερώσει τρία σημεία.
//
// Δεν εισάγει Prisma ή db: φορτώνεται και σε client component.

export type PermissionKey = string;

export interface PermissionDef {
  key: PermissionKey;
  el: string;
  en: string;
  /** Δικαίωμα ενότητας που δεν επιβάλλεται ακόμα — η οθόνη δεν υπάρχει. */
  future?: boolean;
}

export interface PermissionGroup {
  id: string;
  el: string;
  en: string;
  /** Όλη η ενότητα είναι μελλοντική. */
  future?: boolean;
  items: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "dashboard",
    el: "Πίνακας",
    en: "Overview",
    items: [
      { key: "dashboard.view", el: "Προβολή πίνακα", en: "View overview" },
    ],
  },
  {
    id: "bookings",
    el: "Κρατήσεις",
    en: "Bookings",
    items: [
      { key: "bookings.view", el: "Προβολή κρατήσεων", en: "View bookings" },
      { key: "bookings.create", el: "Νέα κράτηση", en: "Create bookings" },
      { key: "bookings.edit", el: "Επεξεργασία κράτησης", en: "Edit bookings" },
      { key: "bookings.cancel", el: "Ακύρωση κράτησης", en: "Cancel bookings" },
      { key: "bookings.status", el: "Αλλαγή κατάστασης", en: "Change status" },
      {
        key: "bookings.override",
        el: "Παράκαμψη σύγκρουσης διαθεσιμότητας",
        en: "Override availability conflicts",
      },
    ],
  },
  {
    id: "calendar",
    el: "Ημερολόγιο",
    en: "Calendar",
    items: [
      { key: "calendar.view", el: "Προβολή ημερολογίου", en: "View calendar" },
    ],
  },
  {
    id: "fleet",
    el: "Στόλος",
    en: "Fleet",
    items: [
      { key: "fleet.view", el: "Προβολή στόλου", en: "View fleet" },
      { key: "fleet.create", el: "Νέο όχημα", en: "Add vehicles" },
      { key: "fleet.edit", el: "Επεξεργασία οχήματος", en: "Edit vehicles" },
      { key: "fleet.delete", el: "Διαγραφή οχήματος", en: "Delete vehicles" },
      { key: "fleet.status", el: "Αλλαγή κατάστασης οχήματος", en: "Change vehicle status" },
    ],
  },
  {
    id: "extras",
    el: "Πρόσθετα",
    en: "Extras",
    items: [
      { key: "extras.view", el: "Προβολή πρόσθετων", en: "View extras" },
      { key: "extras.create", el: "Νέο πρόσθετο", en: "Add extras" },
      { key: "extras.edit", el: "Επεξεργασία πρόσθετου", en: "Edit extras" },
      { key: "extras.delete", el: "Διαγραφή πρόσθετου", en: "Delete extras" },
    ],
  },
  {
    id: "customers",
    el: "Πελάτες",
    en: "Customers",
    items: [
      { key: "customers.view", el: "Προβολή πελατών", en: "View customers" },
      { key: "customers.create", el: "Νέος πελάτης", en: "Add customers" },
      { key: "customers.edit", el: "Επεξεργασία πελάτη", en: "Edit customers" },
      { key: "customers.delete", el: "Διαγραφή πελάτη", en: "Delete customers" },
    ],
  },
  {
    id: "discounts",
    el: "Εκπτώσεις",
    en: "Discounts",
    items: [
      { key: "discounts.view", el: "Προβολή εκπτώσεων", en: "View discounts" },
      { key: "discounts.create", el: "Νέος κωδικός", en: "Create discount codes" },
      { key: "discounts.edit", el: "Επεξεργασία κωδικού", en: "Edit discount codes" },
      { key: "discounts.delete", el: "Απενεργοποίηση κωδικού", en: "Deactivate discount codes" },
    ],
  },
  {
    id: "invoices",
    el: "Τιμολόγια",
    en: "Invoices",
    items: [
      { key: "invoices.view", el: "Προβολή τιμολογίων", en: "View invoices" },
      { key: "invoices.issue", el: "Έκδοση τιμολογίου", en: "Issue invoices" },
      { key: "invoices.markpaid", el: "Σήμανση ως εξοφλημένο", en: "Mark invoices paid" },
      { key: "invoices.print", el: "Εκτύπωση τιμολογίου", en: "Print invoices" },
      {
        key: "invoices.send",
        el: "Αποστολή τιμολογίου με email",
        en: "Email invoices",
        future: true,
      },
    ],
  },
  {
    id: "settings",
    el: "Ρυθμίσεις",
    en: "Settings",
    items: [
      { key: "settings.view", el: "Προβολή ρυθμίσεων", en: "View settings" },
      { key: "settings.edit", el: "Αλλαγή ρυθμίσεων", en: "Change settings" },
    ],
  },
  {
    id: "users",
    el: "Χρήστες",
    en: "Users",
    items: [
      { key: "users.view", el: "Προβολή χρηστών", en: "View users" },
      { key: "users.create", el: "Νέος χρήστης", en: "Add users" },
      { key: "users.permissions", el: "Αλλαγή δικαιωμάτων", en: "Change permissions" },
      { key: "users.delete", el: "Διαγραφή χρήστη", en: "Delete users" },
    ],
  },

  {
    id: "commission",
    el: "Προμήθεια",
    en: "Commission",
    items: [
      {
        key: "commission.view",
        el: "Προβολή της δικής του προμήθειας",
        en: "View own commission",
      },
    ],
  },

  /* ── Ενότητες που δεν έχουν φτιαχτεί ακόμα ──
     Τα κλειδιά υπάρχουν ώστε να μπορούν να δοθούν από τώρα, αλλά κανένα
     API δεν τα ελέγχει μέχρι να υπάρξει η αντίστοιχη οθόνη. */
  {
    id: "contracts",
    el: "Συμβόλαια",
    en: "Contracts",
    future: true,
    items: [
      { key: "contracts.view", el: "Προβολή συμβολαίων", en: "View contracts", future: true },
      { key: "contracts.create", el: "Νέο συμβόλαιο", en: "Create contracts", future: true },
      { key: "contracts.sign", el: "Υπογραφή συμβολαίου", en: "Sign contracts", future: true },
    ],
  },
  {
    id: "service",
    el: "Service & Ζημιές",
    en: "Service & damages",
    future: true,
    items: [
      { key: "service.view", el: "Προβολή service", en: "View service", future: true },
      { key: "service.create", el: "Νέα εγγραφή service", en: "Add service records", future: true },
      { key: "service.edit", el: "Επεξεργασία service", en: "Edit service records", future: true },
    ],
  },
  {
    id: "reports",
    el: "Αναφορές",
    en: "Reports",
    future: true,
    items: [
      { key: "reports.view", el: "Προβολή αναφορών", en: "View reports", future: true },
    ],
  },
  {
    id: "finance",
    el: "Οικονομικά",
    en: "Finance",
    future: true,
    items: [
      { key: "finance.view", el: "Προβολή οικονομικών", en: "View finance", future: true },
      { key: "finance.expense", el: "Καταχώρηση εξόδου", en: "Record expenses", future: true },
    ],
  },
];

/** Όλα τα έγκυρα κλειδιά, σε σειρά εμφάνισης. */
export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key)
);

const VALID = new Set(ALL_PERMISSIONS);

export const isPermissionKey = (key: string): boolean => VALID.has(key);

/** Η ετικέτα ενός κλειδιού στη γλώσσα του χρήστη. */
export function permissionLabel(key: PermissionKey, locale: string): string {
  for (const g of PERMISSION_GROUPS) {
    for (const i of g.items) {
      if (i.key === key) return locale === "en" ? i.en : i.el;
    }
  }
  return key;
}

/* ─────────────────────────────────────────────
   Ο κανόνας
   ───────────────────────────────────────────── */

export type PermissionMap = Record<string, boolean>;

/**
 * Ο διαχειριστής της εταιρίας τα έχει ΠΑΝΤΑ όλα — δεν παραμετροποιείται.
 * Ο Super Admin είναι χρήστης πλατφόρμας και δεν περνά από εδώ για τις
 * σελίδες εταιρίας, αλλά αν φτάσει, δεν τον μπλοκάρουμε.
 */
export function roleHasAll(role: string): boolean {
  return role === "COMPANY_ADMIN" || role === "SUPER_ADMIN";
}

export function can(
  role: string,
  permissions: PermissionMap | null | undefined,
  key: PermissionKey
): boolean {
  if (roleHasAll(role)) return true;
  return permissions?.[key] === true;
}

/**
 * Το πεδίο permissions είναι Json: μπορεί να περιέχει οτιδήποτε, ακόμη και
 * κλειδιά παλιάς ονοματολογίας. Κρατάμε ΜΟΝΟ όσα αναγνωρίζει το μητρώο,
 * ώστε ένα ξεχασμένο κλειδί να μη δίνει ποτέ πρόσβαση.
 */
export function normalizePermissions(value: unknown): PermissionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: PermissionMap = {};
  for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
    if (on === true && VALID.has(key)) out[key] = true;
  }
  return out;
}

/** Λίστα κλειδιών → χάρτης, καθαρισμένος από άγνωστα κλειδιά. */
export function permissionsFromKeys(keys: string[]): PermissionMap {
  const out: PermissionMap = {};
  for (const key of keys) if (VALID.has(key)) out[key] = true;
  return out;
}

/* ─────────────────────────────────────────────
   Προεπιλογές ανά κατηγορία
   ───────────────────────────────────────────── */

/**
 * Ό,τι ΑΚΡΙΒΩΣ μπορούσε να κάνει το Προσωπικό πριν υπάρξουν δικαιώματα ανά
 * χρήστη. Χρησιμοποιείται και ως προεπιλογή σε νέο χρήστη και από το
 * migration, ώστε κανείς να μη χάσει πρόσβαση με το deploy.
 */
export const STAFF_DEFAULTS: PermissionKey[] = [
  "dashboard.view",
  "calendar.view",
  "bookings.view",
  "bookings.create",
  "bookings.edit",
  "bookings.cancel",
  "bookings.status",
  "fleet.view",
  "extras.view",
  "customers.view",
  "customers.create",
  "customers.edit",
  "customers.delete",
  "invoices.view",
  "invoices.issue",
  "invoices.markpaid",
  "invoices.print",
  "commission.view",
];

// Σημείωση: Εκπτώσεις και Ρυθμίσεις ΔΕΝ μπαίνουν στις προεπιλογές. Μέχρι
// σήμερα οι σελίδες τους ανακατεύθυναν το Προσωπικό στον Πίνακα, οπότε
// «ό,τι έκανε ως τώρα» σημαίνει χωρίς αυτές. Ο διαχειριστής μπορεί να
// τους τα δώσει με ένα κλικ.

/** Ο συνεργάτης έβλεπε· δεν άλλαζε τίποτα. */
export const PARTNER_DEFAULTS: PermissionKey[] = [
  "dashboard.view",
  "calendar.view",
  "bookings.view",
  "fleet.view",
  "extras.view",
  "commission.view",
];

export function defaultsForRole(role: string): PermissionMap {
  if (role === "STAFF") return permissionsFromKeys(STAFF_DEFAULTS);
  if (role === "PARTNER") return permissionsFromKeys(PARTNER_DEFAULTS);
  return {};
}
