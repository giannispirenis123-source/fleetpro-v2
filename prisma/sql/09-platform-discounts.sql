-- prisma/sql/09-platform-discounts.sql
--
-- Εκπτώσεις Super Admin στη ΣΥΝΔΡΟΜΗ μιας εταιρίας.
--
-- Νέος πίνακας "platform_discounts" + enum "PlatformDiscountType".
-- ΔΕΝ αγγίζει τον πίνακα "discounts" (εκπτώσεις κρατήσεων) ούτε τον
-- αχρησιμοποίητο "platform_coupons".
--
-- Μόνο αποθήκευση/εμφάνιση· δεν συνδέεται ακόμα με Stripe.
--
-- Ασφαλές να τρέξει πολλές φορές.
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → 04 → 05 → 06 → 07 → 08 → 09,
-- και το 02-seed οποτεδήποτε μετά το 01-schema.

-- ── 1) Enum τύπου ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlatformDiscountType') THEN
    CREATE TYPE "PlatformDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');
  END IF;
END $$;

-- ── 2) Πίνακας ──
CREATE TABLE IF NOT EXISTS "platform_discounts" (
    "id"         TEXT                   NOT NULL,
    "tenantId"   TEXT                   NOT NULL,
    "type"       "PlatformDiscountType" NOT NULL,
    "value"      DECIMAL(10,2)          NOT NULL,
    "validFrom"  DATE                   NOT NULL,
    "validUntil" DATE,
    "active"     BOOLEAN                NOT NULL DEFAULT true,
    "note"       TEXT,
    "createdAt"  TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_discounts_pkey" PRIMARY KEY ("id")
);

-- ── 3) Index ──
CREATE INDEX IF NOT EXISTS "platform_discounts_tenantId_idx"
  ON "platform_discounts" ("tenantId");

-- ── 4) Ξένο κλειδί + έλεγχοι τιμών (δεύτερη γραμμή άμυνας μετά το API) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_discounts_tenantId_fkey') THEN
    ALTER TABLE "platform_discounts"
      ADD CONSTRAINT "platform_discounts_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_discounts_value_check') THEN
    ALTER TABLE "platform_discounts"
      ADD CONSTRAINT "platform_discounts_value_check"
      CHECK ("value" > 0 AND ("type" <> 'PERCENTAGE' OR "value" <= 100));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_discounts_dates_check') THEN
    ALTER TABLE "platform_discounts"
      ADD CONSTRAINT "platform_discounts_dates_check"
      CHECK ("validUntil" IS NULL OR "validUntil" >= "validFrom");
  END IF;
END $$;

-- ── Έλεγχος ── (αναμενόμενο: 1 | 1 | 9 | 1 | 3)
SELECT
  (SELECT count(*) FROM pg_type
     WHERE typname = 'PlatformDiscountType')                          AS "enum",
  (SELECT count(*) FROM information_schema.tables
     WHERE table_name = 'platform_discounts')                         AS "πίνακας",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'platform_discounts')                         AS "στήλες (9)",
  (SELECT count(*) FROM pg_indexes
     WHERE indexname = 'platform_discounts_tenantId_idx')             AS "index",
  (SELECT count(*) FROM pg_constraint WHERE conname IN (
     'platform_discounts_tenantId_fkey',
     'platform_discounts_value_check',
     'platform_discounts_dates_check'))                               AS "constraints (3)";
