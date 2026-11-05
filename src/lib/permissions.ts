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
  /** Δεν δίνεται ποτέ σε συνεργάτη (κρύβεται και δεν ισχύει — βλ. can()). */
  notForPartner?: boolean;
}

export interface PermissionGroup {
  id: string;
  el: string;
  en: string;
  /** Όλη η ενότητα είναι μελλοντική. */
  future?: boolean;
  /** Η ενότητα αφορά ΜΟΝΟ αυτούς τους ρόλους (φαίνεται μόνο σε αυτούς). */
  onlyFor?: string[];
  /** Η ενότητα ΔΕΝ δίνεται ποτέ σε συνεργάτη (κρύβεται και δεν ισχύει — βλ. can()). */
  notForPartner?: boolean;
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
    notForPartner: true,
    el: "Ρυθμίσεις",
    en: "Settings",
    items: [
      { key: "settings.view", el: "Προβολή ρυθμίσεων", en: "View settings" },
      { key: "settings.edit", el: "Αλλαγή ρυθμίσεων", en: "Change settings" },
    ],
  },
  {
    id: "users",
    notForPartner: true,
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
    id: "service",
    el: "Service & ΚΤΕΟ",
    en: "Service & MOT",
    items: [
      { key: "service.view", el: "Προβολή εγγραφών service", en: "View service records" },
      { key: "service.create", el: "Νέα εγγραφή service", en: "Add service records" },
      { key: "service.edit", el: "Επεξεργασία εγγραφής", en: "Edit service records" },
      { key: "service.delete", el: "Διαγραφή εγγραφής", en: "Delete service records" },
    ],
  },
  {
    id: "damages",
    el: "Ζημιές",
    en: "Damages",
    items: [
      { key: "damages.view", el: "Προβολή ζημιών", en: "View damages" },
      { key: "damages.create", el: "Καταχώρηση ζημιάς", en: "Record damages" },
      { key: "damages.edit", el: "Επεξεργασία / επίλυση ζημιάς", en: "Edit or resolve damages" },
      { key: "damages.delete", el: "Διαγραφή ζημιάς", en: "Delete damages" },
    ],
  },
  {
    id: "partner",
    el: "Συνεργάτης",
    en: "Partner",
    onlyFor: ["PARTNER"],
    items: [
      { key: "partner.availability", el: "Μπορεί να βλέπει διαθεσιμότητα", en: "Can view availability" },
      { key: "partner.book", el: "Μπορεί να κάνει κράτηση", en: "Can make bookings" },
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
      {
        key: "commission.partners",
        el: "Προβολή προμηθειών συνεργατών",
        en: "View partner commissions",
        notForPartner: true,
      },
    ],
  },
  {
    id: "finance",
    notForPartner: true,
    el: "Οικονομικά",
    en: "Finance",
    items: [
      { key: "finance.view", el: "Προβολή οικονομικών", en: "View finance" },
      { key: "finance.create", el: "Καταχώρηση εξόδου", en: "Record expenses" },
      { key: "finance.edit", el: "Επεξεργασία εξόδου", en: "Edit expenses" },
      { key: "finance.delete", el: "Διαγραφή εξόδου", en: "Delete expenses" },
    ],
  },

  {
    id: "contracts",
    el: "Συμβόλαια",
    en: "Contracts",
    items: [
      { key: "contracts.view", el: "Προβολή / εκτύπωση συμβολαίων", en: "View / print contracts" },
      { key: "contracts.create", el: "Νέο συμβόλαιο", en: "Create contracts" },
      {
        key: "contracts.edit",
        el: "Επεξεργασία και υπογραφή συμβολαίου",
        en: "Edit and sign contracts",
      },
      { key: "contracts.delete", el: "Διαγραφή πρόχειρου συμβολαίου", en: "Delete draft contracts" },
      {
        key: "contracts.price",
        el: "Αλλαγή τιμής στο συμβόλαιο (χειροκίνητη τελική τιμή)",
        en: "Change the contract price (manual final price)",
      },
    ],
  },
  {
    id: "reports",
    notForPartner: true,
    el: "Αναφορές",
    en: "Reports",
    items: [
      {
        key: "reports.view",
        el: "Προβολή αναφορών (όχι για συνεργάτες)",
        en: "View reports (not for partners)",
      },
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

/** Κλειδιά που ο συνεργάτης ΔΕΝ έχει ποτέ (οικονομικά/ρυθμίσεις/χρήστες/αναφορές εταιρίας). */
export const PARTNER_NEVER: ReadonlySet<PermissionKey> = new Set(
  PERMISSION_GROUPS.flatMap((g) => g.items.filter((i) => g.notForPartner || i.notForPartner).map((i) => i.key))
);

export function can(
  role: string,
  permissions: PermissionMap | null | undefined,
  key: PermissionKey
): boolean {
  if (roleHasAll(role)) return true;
  // Ό,τι κι αν γράφει το JSON (π.χ. παλιά χειροκίνητη ανάθεση), ο συνεργάτης
  // δεν βλέπει ποτέ οικονομικά, ρυθμίσεις, χρήστες ή αναφορές της εταιρίας.
  if (role === "PARTNER" && PARTNER_NEVER.has(key)) return false;
  return permissions?.[key] === true;
}

/**
 * Δικαιώματα που προϋποθέτουν άλλα: «κράτηση» χωρίς «διαθεσιμότητα» δεν έχει
 * νόημα, οπότε το πρώτο φέρνει πάντα και το δεύτερο. Εφαρμόζεται σε ΚΑΘΕ
 * αποθήκευση/ανάγνωση (permissionsFromKeys, normalizePermissions) και στο UI.
 */
export const PERMISSION_IMPLIES: Readonly<Record<PermissionKey, PermissionKey[]>> = {
  "partner.book": ["partner.availability"],
};

function withImplied(map: PermissionMap): PermissionMap {
  for (const [key, needs] of Object.entries(PERMISSION_IMPLIES)) {
    if (map[key]) for (const n of needs) map[n] = true;
  }
  return map;
}

/**
 * Checkbox στο UI: ενεργοποίηση φέρνει ό,τι προϋποθέτει· απενεργοποίηση
 * αφαιρεί ό,τι εξαρτάται από αυτό (π.χ. χωρίς διαθεσιμότητα → χωρίς κράτηση).
 */
export function togglePermission(map: PermissionMap, key: PermissionKey, on: boolean): PermissionMap {
  const next = { ...map };
  if (on) {
    next[key] = true;
    withImplied(next);
  } else {
    delete next[key];
    for (const [k, needs] of Object.entries(PERMISSION_IMPLIES)) if (needs.includes(key)) delete next[k];
  }
  return next;
}

/** Οι ενότητες που φαίνονται για έναν ρόλο (π.χ. «Συνεργάτης» μόνο σε συνεργάτη). */
export function groupsForRole(role: string): PermissionGroup[] {
  return PERMISSION_GROUPS.filter(
    (g) => (!g.onlyFor || g.onlyFor.includes(role)) && !(g.notForPartner && role === "PARTNER")
  ).map((g) => (role === "PARTNER" ? { ...g, items: g.items.filter((i) => !i.notForPartner) } : g));
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
  return withImplied(out);
}

/** Λίστα κλειδιών → χάρτης, καθαρισμένος από άγνωστα κλειδιά. */
export function permissionsFromKeys(keys: string[]): PermissionMap {
  const out: PermissionMap = {};
  for (const key of keys) if (VALID.has(key)) out[key] = true;
  return withImplied(out);
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
  "service.view",
  "service.create",
  "service.edit",
  "service.delete",
  "damages.view",
  "damages.create",
  "damages.edit",
  "damages.delete",
  "contracts.view",
  "contracts.create",
  "contracts.edit",
];

// Σημείωση: Εκπτώσεις, Ρυθμίσεις, Οικονομικά και Αναφορές ΔΕΝ μπαίνουν στις προεπιλογές. Μέχρι
// σήμερα οι σελίδες τους ανακατεύθυναν το Προσωπικό στον Πίνακα, οπότε
// «ό,τι έκανε ως τώρα» σημαίνει χωρίς αυτές. Ο διαχειριστής μπορεί να
// τους τα δώσει με ένα κλικ.

/**
 * Ο συνεργάτης έβλεπε· δεν άλλαζε τίποτα. Τα «partner.availability» και
 * «partner.book» ΔΕΝ μπαίνουν εδώ: προεπιλογή ατικάριστα, ώστε κανένας
 * υπάρχων συνεργάτης να μην αλλάξει συμπεριφορά.
 */
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
