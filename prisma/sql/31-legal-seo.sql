-- prisma/sql/31-legal-seo.sql
-- Δημόσιο site: νομικά κείμενα (όροι, απόρρητο, cookies) και η έκδοση όρων
-- που αποδέχτηκε ο πελάτης στην κράτηση.
--   · site_legal_texts — ΜΟΝΟ τα κείμενα που αποθήκευσε η ίδια η εταιρία. Κάθε
--     αποθήκευση = νέα γραμμή (version + 1): το ιστορικό μένει, ώστε να φαίνεται
--     ποιο κείμενο ίσχυε σε μια παλιά κράτηση. Χωρίς γραμμή = το πρότυπο.
--   · bookings."termsVersion" / "termsAcceptedAt" — π.χ. "terms/el/v3" ή
--     "terms/el/template-2026-10-21". NULL = κράτηση πριν από αυτό το SQL ή από το dashboard.
-- Τα πεδία SEO (τίτλος/περιγραφή ανά γλώσσα) μπαίνουν στο υπάρχον
-- tenants."storefrontSettings" (JSONB) — καμία στήλη.
-- Μόνο προσθήκες· η παλιά έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

CREATE TABLE IF NOT EXISTS "site_legal_texts" (
  "id"          TEXT         NOT NULL,
  "tenantId"    TEXT         NOT NULL,
  "kind"        TEXT         NOT NULL,
  "lang"        TEXT         NOT NULL,
  "version"     INTEGER      NOT NULL,
  "body"        TEXT         NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_legal_texts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "site_legal_texts_tenantId_kind_lang_version_key"
  ON "site_legal_texts" ("tenantId", "kind", "lang", "version");

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_legal_texts_tenantId_fkey') THEN
    ALTER TABLE "site_legal_texts" ADD CONSTRAINT "site_legal_texts_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_legal_texts_kind_check') THEN
    ALTER TABLE "site_legal_texts" ADD CONSTRAINT "site_legal_texts_kind_check"
      CHECK ("kind" IN ('terms', 'privacy', 'cookies'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_legal_texts_version_check') THEN
    ALTER TABLE "site_legal_texts" ADD CONSTRAINT "site_legal_texts_version_check" CHECK ("version" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_legal_texts_body_check') THEN
    ALTER TABLE "site_legal_texts" ADD CONSTRAINT "site_legal_texts_body_check" CHECK (length("body") <= 30000);
  END IF;
END $$;

COMMIT;

-- Verification — αναμενόμενο: legal_table = 1 · legal_unique = 1 · constraints = 4 · booking_columns = 2
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_legal_texts') AS legal_table,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'site_legal_texts_tenantId_kind_lang_version_key') AS legal_unique,
  (SELECT count(*) FROM pg_constraint WHERE conname IN (
    'site_legal_texts_tenantId_fkey', 'site_legal_texts_kind_check',
    'site_legal_texts_version_check', 'site_legal_texts_body_check')) AS constraints,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name IN ('termsVersion', 'termsAcceptedAt')) AS booking_columns;
