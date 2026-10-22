-- prisma/sql/33-custom-domain-email-sender.sql
-- «Domain-ready»: δικό του domain για το δημόσιο site και δικός του
-- αποστολέας email ανά εταιρία — ΠΡΙΝ αγοραστεί οποιοδήποτε domain.
--   · tenants."customDomain" (υπάρχει ήδη από το 01, UNIQUE): το host του site
--     σε πεζά, χωρίς http/θύρα/διαδρομή (π.χ. "www.helios-rent.gr").
--     Επιπλέον UNIQUE στο lower(), ώστε δύο εταιρίες να μην έχουν ποτέ το ίδιο.
--   · "customDomainStatus" PENDING | VERIFIED — το site σερβίρεται στο domain
--     ΜΟΝΟ όταν είναι VERIFIED (από το κουμπί «Έλεγχος domain»).
--   · "customDomainVerifiedAt" — πότε επαληθεύτηκε.
--   · "emailFromName" / "emailFromAddress" — αποστολέας των email της εταιρίας
--     (συμβόλαιο, τιμολόγιο, απόφαση κράτησης).
--   · "emailSenderStatus" UNVERIFIED | VERIFIED (χειροκίνητα από Admin, μετά
--     την επαλήθευση στο Resend) + "emailSenderVerifiedAt".
--     Χωρίς VERIFIED αποστολέα → το κοινό EMAIL_FROM, όπως σήμερα.
-- Μόνο προσθήκες· η σημερινή έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "customDomainStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "customDomainVerifiedAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "emailFromName" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "emailFromAddress" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "emailSenderStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "emailSenderVerifiedAt" TIMESTAMP(3);

-- Παλιές τιμές από το Super Admin (ελεύθερο κείμενο, ποτέ δεν χρησιμοποιήθηκαν):
-- κενό → NULL, και κάθε υπάρχον domain ξεκινά ως PENDING (δεν σερβίρει τίποτα).
UPDATE "tenants" SET "customDomain" = NULL WHERE "customDomain" IS NOT NULL AND btrim("customDomain") = '';
UPDATE "tenants" SET "customDomain" = lower(btrim("customDomain"))
  WHERE "customDomain" IS NOT NULL AND "customDomain" <> lower(btrim("customDomain"));
UPDATE "tenants" SET "customDomainStatus" = 'PENDING', "customDomainVerifiedAt" = NULL
  WHERE "customDomain" IS NULL AND "customDomainStatus" <> 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_customDomain_lower_key" ON "tenants" (lower("customDomain"));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_customDomainStatus_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_customDomainStatus_check"
      CHECK ("customDomainStatus" IN ('PENDING', 'VERIFIED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_customDomain_format_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_customDomain_format_check"
      CHECK ("customDomain" IS NULL OR ("customDomain" = lower("customDomain") AND length("customDomain") <= 253
        AND "customDomain" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_emailSenderStatus_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_emailSenderStatus_check"
      CHECK ("emailSenderStatus" IN ('UNVERIFIED', 'VERIFIED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_emailFrom_length_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_emailFrom_length_check"
      CHECK (coalesce(length("emailFromName"), 0) <= 80 AND coalesce(length("emailFromAddress"), 0) <= 254);
  END IF;
END $$;

COMMIT;

-- Verification — αναμενόμενο: columns = 6 · lower_unique = 1 · constraints = 4 · verified_domains = 0 · verified_senders = 0
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name IN (
      'customDomainStatus', 'customDomainVerifiedAt', 'emailFromName',
      'emailFromAddress', 'emailSenderStatus', 'emailSenderVerifiedAt')) AS columns,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'tenants_customDomain_lower_key') AS lower_unique,
  (SELECT count(*) FROM pg_constraint WHERE conname IN (
    'tenants_customDomainStatus_check', 'tenants_customDomain_format_check',
    'tenants_emailSenderStatus_check', 'tenants_emailFrom_length_check')) AS constraints,
  (SELECT count(*) FROM "tenants" WHERE "customDomainStatus" = 'VERIFIED') AS verified_domains,
  (SELECT count(*) FROM "tenants" WHERE "emailSenderStatus" = 'VERIFIED') AS verified_senders;
