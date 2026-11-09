-- prisma/sql/40-discount-partner.sql
-- Κωδικός έκπτωσης ΑΝΑΤΕΘΕΙΜΕΝΟΣ σε συνεργάτη (τον ορίζει ΜΟΝΟ η εταιρία).
--   · discounts."partnerId": NULLABLE, FK → users ON DELETE SET NULL.
--     NULL = κωδικός της εταιρίας. Με τιμή: η έκπτωση αφαιρείται από την
--     προμήθεια ΑΥΤΟΥ του συνεργάτη στις κρατήσεις του site.
--   · index ("tenantId", "partnerId") για τη λίστα του συνεργάτη.
--   · Backfill ΜΙΑΣ φοράς: κωδικοί που ΔΗΜΙΟΥΡΓΗΣΕ συνεργάτης της ΙΔΙΑΣ
--     εταιρίας (SQL 39, createdById) → partnerId = createdById. ΚΑΜΙΑ άλλη
--     γραμμή δεν αλλάζει· οι κρατήσεις δεν αγγίζονται· το createdById μένει.
-- Μόνο προσθήκη. Idempotent (ξανά → καμία αλλαγή). Τρέχει στο Supabase SQL
-- Editor ΠΡΙΝ από το preview (ο νέος κώδικας διαβάζει τη στήλη).

BEGIN;

ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "partnerId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discounts_partnerId_fkey') THEN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_partnerId_fkey"
      FOREIGN KEY ("partnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "discounts_tenantId_partnerId_idx" ON "discounts" ("tenantId", "partnerId");

-- Backfill: ΜΟΝΟ κωδικοί χωρίς partnerId, με δημιουργό ΣΥΝΕΡΓΑΤΗ της ίδιας εταιρίας.
UPDATE "discounts" d
SET "partnerId" = d."createdById"
FROM "users" u
WHERE d."partnerId" IS NULL
  AND d."createdById" IS NOT NULL
  AND u."id" = d."createdById"
  AND u."role" = 'PARTNER'::"UserRole"
  AND u."tenantId" = d."tenantId";

COMMIT;

-- Verification — αναμενόμενο: column_nullable = YES · fk_set_null = 1 · index_exists = 1 ·
-- codes_with_partner = (πλήθος κωδικών συνεργατών) · bad_partner_links = 0
SELECT
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'discounts' AND column_name = 'partnerId') AS column_nullable,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'discounts_partnerId_fkey' AND confdeltype = 'n') AS fk_set_null,
  (SELECT count(*) FROM pg_indexes
    WHERE tablename = 'discounts' AND indexname = 'discounts_tenantId_partnerId_idx') AS index_exists,
  (SELECT count(*) FROM "discounts" WHERE "partnerId" IS NOT NULL) AS codes_with_partner,
  (SELECT count(*) FROM "discounts" d LEFT JOIN "users" u ON u."id" = d."partnerId"
    WHERE d."partnerId" IS NOT NULL
      AND (u."id" IS NULL OR u."role" <> 'PARTNER'::"UserRole" OR u."tenantId" IS DISTINCT FROM d."tenantId")) AS bad_partner_links;

-- Ποιοι κωδικοί έχουν πλέον συνεργάτη (για έλεγχο με το μάτι):
SELECT d."code", d."type", d."value", d."isActive", u."name" AS partner, u."commissionRate"
FROM "discounts" d JOIN "users" u ON u."id" = d."partnerId"
ORDER BY d."tenantId", d."code";
