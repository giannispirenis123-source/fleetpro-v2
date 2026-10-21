// src/lib/legal/legal.ts
// Νομικά κείμενα του δημόσιου site — καθαρή λογική + zod (χωρίς db).
//
// Ποιο κείμενο ισχύει: η ΜΕΓΑΛΥΤΕΡΗ έκδοση που αποθήκευσε η εταιρία για
// (είδος, γλώσσα)· αλλιώς το πρότυπο (templates.ts). Τα {{…}} γεμίζουν ΠΑΝΤΑ
// με τα στοιχεία της ΙΔΙΑΣ εταιρίας (fillPlaceholders).
//
// Έκδοση που αποθηκεύεται στην κράτηση (bookings."termsVersion"):
//   "terms/el/v3"                   — 3η αποθήκευση της εταιρίας
//   "terms/el/template-2026-10-21"  — το πρότυπο αυτής της ημερομηνίας

import { z } from "zod";
import { LEGAL_KINDS, TEMPLATE_UPDATED, TEMPLATE_VERSION, legalTemplate, type LegalKind } from "./templates";

export { LEGAL_KINDS, type LegalKind };

export const LEGAL_BODY_MAX = 30000;

export const isLegalKind = (v: unknown): v is LegalKind =>
  typeof v === "string" && (LEGAL_KINDS as readonly string[]).includes(v);

/** Τα στοιχεία της εταιρίας που μπαίνουν στα {{…}} — όλα δημόσια επιχειρηματικά στοιχεία. */
export interface LegalCompany {
  name: string;
  vat: string | null;
  taxOffice: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

export const PLACEHOLDERS = ["company", "vat", "taxOffice", "address", "email", "phone"] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

const MISSING = "—";

/** {{company}} κ.λπ. → τα στοιχεία της εταιρίας· άγνωστα {{…}} μένουν όπως είναι. */
export function fillPlaceholders(body: string, c: LegalCompany): string {
  const values: Record<Placeholder, string | null> = {
    company: c.name,
    vat: c.vat,
    taxOffice: c.taxOffice,
    address: c.address,
    email: c.email,
    phone: c.phone,
  };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) =>
    (PLACEHOLDERS as readonly string[]).includes(key) ? values[key as Placeholder]?.trim() || MISSING : all
  );
}

/** Ποια στοιχεία λείπουν (για προειδοποίηση στο dashboard). */
export function missingCompanyFields(c: LegalCompany): Placeholder[] {
  return (["vat", "address", "email", "phone"] as const).filter((k) => !c[k]?.trim());
}

/** Γραμμή της βάσης (site_legal_texts). */
export interface LegalRow {
  tenantId: string;
  kind: string;
  lang: string;
  version: number;
  body: string;
  createdAt: Date;
}

export interface LegalDoc {
  kind: LegalKind;
  lang: string;
  /** Markdown ΜΕ τα στοιχεία της εταιρίας. */
  body: string;
  /** YYYY-MM-DD */
  updated: string;
  isTemplate: boolean;
  /** Αυτό που γράφεται στην κράτηση. */
  versionId: string;
}

export const templateVersionId = (kind: LegalKind, lang: string) => `${kind}/${lang}/template-${TEMPLATE_VERSION}`;
export const customVersionId = (kind: LegalKind, lang: string, version: number) => `${kind}/${lang}/v${version}`;

/** Η γλώσσα του κειμένου: ό,τι ζήτησε η σελίδα (el/en· οι άλλες → en). */
export const legalLang = (lang: string) => (lang === "el" ? "el" : "en");

/**
 * Το κείμενο που ισχύει για (εταιρία, είδος, γλώσσα). `rows` = ΜΟΝΟ γραμμές
 * της εταιρίας `companyId`· όποια άλλη αγνοείται (άμυνα σε βάθος).
 */
export function resolveLegalDoc(
  companyId: string,
  rows: LegalRow[],
  kind: LegalKind,
  lang: string,
  company: LegalCompany
): LegalDoc {
  const l = legalLang(lang);
  const own = rows
    .filter((r) => r.tenantId === companyId && r.kind === kind && r.lang === l)
    .sort((a, b) => b.version - a.version)[0];
  if (own) {
    return {
      kind,
      lang: l,
      body: fillPlaceholders(own.body, company),
      updated: own.createdAt.toISOString().slice(0, 10),
      isTemplate: false,
      versionId: customVersionId(kind, l, own.version),
    };
  }
  return {
    kind,
    lang: l,
    body: fillPlaceholders(legalTemplate(kind, l), company),
    updated: TEMPLATE_UPDATED,
    isTemplate: true,
    versionId: templateVersionId(kind, l),
  };
}

/* ─────────────────────────────────────────────
   «Η σελίδα μου» → «Νομικά» — PUT /api/public-site/legal
   ───────────────────────────────────────────── */

export const legalSaveSchema = z.object({
  kind: z.enum(LEGAL_KINDS),
  lang: z.enum(["el", "en"]),
  body: z
    .string()
    .max(LEGAL_BODY_MAX, `Έως ${LEGAL_BODY_MAX} χαρακτήρες`)
    .refine((s) => s.trim().length >= 20, "Το κείμενο είναι πολύ μικρό"),
});

export type LegalSave = z.infer<typeof legalSaveSchema>;

/** Κείμενο προς αποθήκευση: κανονικές αλλαγές γραμμής, χωρίς κενά στο τέλος. */
export const normalizeLegalBody = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim() + "\n";

/** Ημερομηνία YYYY-MM-DD → «21/10/2026» (el) ή «21 Oct 2026» (en). */
export function formatLegalDate(iso: string, lang: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  if (lang === "el") return `${d}/${m}/${y}`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
