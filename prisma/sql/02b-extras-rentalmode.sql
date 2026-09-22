-- prisma/sql/02b-extras-rentalmode.sql
--
-- Πρόσθετα & ασφάλειες ανά εταιρία, και τρόπος λειτουργίας
-- (άμεση κράτηση ή αίτημα προς έγκριση).
-- Αντιστοιχεί στο commit 7aa5414 «feat: extras, rental mode and bookings step 1».
--
-- ΗΔΗ ΕΦΑΡΜΟΣΜΕΝΟ στην παραγωγή. Το αρχείο υπάρχει ώστε το schema να
-- ξαναστήνεται από το μηδέν· είναι ασφαλές να ξανατρέξει.
--
-- Σειρά εκτέλεσης: 01-schema.sql → 01b → 02b → 03 → 02-seed.sql

-- ── 1) Enums ──
-- Η PostgreSQL δεν υποστηρίζει CREATE TYPE IF NOT EXISTS, οπότε
-- κάθε τύπος μπαίνει μέσα σε έλεγχο ύπαρξης.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChargeType') THEN
    CREATE TYPE "ChargeType" AS ENUM ('PER_DAY', 'ONE_OFF');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExtraType') THEN
    CREATE TYPE "ExtraType" AS ENUM ('EXTRA', 'INSURANCE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RentalMode') THEN
    CREATE TYPE "RentalMode" AS ENUM ('BOOKING', 'REQUEST');
  END IF;
END $$;

-- ── 2) Τρόπος λειτουργίας ανά εταιρία ──
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "rentalMode" "RentalMode" NOT NULL DEFAULT 'BOOKING';

-- ── 3) Πίνακας πρόσθετων ──
CREATE TABLE IF NOT EXISTS "extras" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "price"      DECIMAL(10,2) NOT NULL,
    "chargeType" "ChargeType" NOT NULL DEFAULT 'PER_DAY',
    "type"       "ExtraType" NOT NULL DEFAULT 'EXTRA',
    "isActive"   BOOLEAN NOT NULL DEFAULT true,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extras_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "extras_tenantId_idx" ON "extras"("tenantId");

-- Το ADD CONSTRAINT δεν δέχεται IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'extras_tenantId_fkey'
  ) THEN
    ALTER TABLE "extras"
      ADD CONSTRAINT "extras_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Έλεγχος
SELECT
  (SELECT count(*) FROM pg_type WHERE typname IN ('ChargeType','ExtraType','RentalMode')) AS "enums (3)",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'tenants' AND column_name = 'rentalMode')                         AS "tenants.rentalMode",
  (SELECT count(*) FROM information_schema.tables
     WHERE table_name = 'extras')                                                         AS "πίνακας extras",
  (SELECT count(*) FROM pg_constraint WHERE conname = 'extras_tenantId_fkey')             AS "FK";
