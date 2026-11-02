-- prisma/sql/39-discount-created-by.sql
-- Ποιος δημιούργησε κάθε κωδικό έκπτωσης (για τους συνεργάτες: βλέπουν και
-- αλλάζουν ΜΟΝΟ τους δικούς τους κωδικούς).
--   · discounts."createdById": NULLABLE, FK → users ON DELETE SET NULL.
--     Οι υπάρχοντες κωδικοί μένουν NULL (= κωδικοί της εταιρίας)· ΚΑΜΙΑ αλλαγή
--     σε υπάρχουσες γραμμές.
--   · index ("tenantId", "createdById") για τη λίστα του συνεργάτη.
-- Μόνο προσθήκη. Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από το
-- deploy/preview (ο νέος κώδικας διαβάζει τη στήλη).

BEGIN;

ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discounts_createdById_fkey') THEN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "discounts_tenantId_createdById_idx" ON "discounts" ("tenantId", "createdById");

COMMIT;

-- Verification — αναμενόμενο: column_nullable = YES · fk_set_null = 1 · index_exists = 1 · rows_with_creator = 0
SELECT
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'discounts' AND column_name = 'createdById') AS column_nullable,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'discounts_createdById_fkey' AND confdeltype = 'n') AS fk_set_null,
  (SELECT count(*) FROM pg_indexes
    WHERE tablename = 'discounts' AND indexname = 'discounts_tenantId_createdById_idx') AS index_exists,
  (SELECT count(*) FROM "discounts" WHERE "createdById" IS NOT NULL) AS rows_with_creator;
