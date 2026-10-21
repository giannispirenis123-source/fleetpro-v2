// src/lib/legal/legalServer.ts
// Νομικά κείμενα — ΜΟΝΟ server. Κάθε ερώτημα φιλτράρει με το companyId που
// έδωσε ο καλών (resolveStorefrontCompany στο site, η συνεδρία στο dashboard)
// — ποτέ με κάτι από το URL ή το body.

import { db } from "../db";
import {
  LEGAL_KINDS,
  legalLang,
  normalizeLegalBody,
  resolveLegalDoc,
  type LegalCompany,
  type LegalDoc,
  type LegalKind,
  type LegalRow,
} from "./legal";

const ROW_SELECT = { tenantId: true, kind: true, lang: true, version: true, body: true, createdAt: true } as const;

/** Τα στοιχεία της εταιρίας για τα {{…}}: επικοινωνία του site, αλλιώς των Ρυθμίσεων. */
export async function loadLegalCompany(companyId: string): Promise<LegalCompany | null> {
  const t = await db.tenant.findUnique({
    where: { id: companyId },
    select: { name: true, vat: true, taxOffice: true, address: true, region: true, email: true, phone: true, storefrontSettings: true },
  });
  if (!t) return null;
  const s = (t.storefrontSettings ?? {}) as { contact?: { email?: unknown; phone?: unknown } };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    name: t.name,
    vat: str(t.vat),
    taxOffice: str(t.taxOffice),
    address: [t.address, t.region].map(str).filter(Boolean).join(", ") || null,
    email: str(s.contact?.email) ?? str(t.email),
    phone: str(s.contact?.phone) ?? str(t.phone),
  };
}

/** Η τελευταία έκδοση ανά (είδος, γλώσσα) της εταιρίας. */
async function latestRows(companyId: string, kind?: LegalKind, lang?: string): Promise<LegalRow[]> {
  return db.siteLegalText.findMany({
    where: { tenantId: companyId, ...(kind && { kind }), ...(lang && { lang }) },
    select: ROW_SELECT,
    orderBy: { version: "desc" },
    distinct: ["kind", "lang"],
  });
}

/** Το κείμενο που βλέπει ο επισκέπτης (ή null αν η εταιρία δεν βρέθηκε). */
export async function loadLegalDoc(companyId: string, kind: LegalKind, lang: string): Promise<LegalDoc | null> {
  const [company, rows] = await Promise.all([loadLegalCompany(companyId), latestRows(companyId, kind, legalLang(lang))]);
  return company ? resolveLegalDoc(companyId, rows, kind, lang, company) : null;
}

/** Η έκδοση όρων που ισχύει ΤΩΡΑ — γράφεται στην κράτηση. */
export async function currentTermsVersion(companyId: string, lang: string): Promise<string> {
  const rows = await latestRows(companyId, "terms", legalLang(lang));
  const blank: LegalCompany = { name: "", vat: null, taxOffice: null, address: null, email: null, phone: null };
  return resolveLegalDoc(companyId, rows, "terms", lang, blank).versionId;
}

export interface LegalAdminEntry {
  kind: LegalKind;
  lang: "el" | "en";
  /** Το δικό τους κείμενο (με τα {{…}} όπως τα έγραψαν) ή null = πρότυπο. */
  body: string | null;
  version: number | null;
  updated: string;
  isTemplate: boolean;
}

export async function loadLegalAdmin(companyId: string): Promise<LegalAdminEntry[]> {
  const rows = await latestRows(companyId);
  const out: LegalAdminEntry[] = [];
  for (const kind of LEGAL_KINDS) {
    for (const lang of ["el", "en"] as const) {
      const own = rows.find((r) => r.kind === kind && r.lang === lang);
      const doc = resolveLegalDoc(companyId, own ? [own] : [], kind, lang, { name: "", vat: null, taxOffice: null, address: null, email: null, phone: null });
      out.push({ kind, lang, body: own?.body ?? null, version: own?.version ?? null, updated: doc.updated, isTemplate: doc.isTemplate });
    }
  }
  return out;
}

/** Νέα έκδοση (version + 1). Ίδιο κείμενο με την τρέχουσα → καμία νέα γραμμή. */
export async function saveLegalText(companyId: string, kind: LegalKind, lang: "el" | "en", body: string, userId: string | null) {
  const text = normalizeLegalBody(body);
  return db.$transaction(async (tx) => {
    // Ένα κλείδωμα ανά (εταιρία, είδος, γλώσσα): δύο ταυτόχρονες αποθηκεύσεις δεν παίρνουν ίδιο version.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legal|${companyId}|${kind}|${lang}`}))`;
    const last = await tx.siteLegalText.findFirst({
      where: { tenantId: companyId, kind, lang },
      orderBy: { version: "desc" },
      select: { version: true, body: true },
    });
    if (last && last.body === text) return { version: last.version, changed: false };
    const row = await tx.siteLegalText.create({
      data: { tenantId: companyId, kind, lang, version: (last?.version ?? 0) + 1, body: text, createdById: userId },
      select: { version: true },
    });
    return { version: row.version, changed: true };
  });
}
