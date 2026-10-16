-- prisma/sql/23-public-booking.sql
-- Δημόσιο site 3/4: κράτηση από το site.
--   · bookings."publicCode"    — κωδικός που βλέπει ο πελάτης (XXXX-XXXX), UNIQUE σε όλη τη βάση
--   · bookings."rentalGroupId" — η ομάδα που διάλεξε στο site (FK, ON DELETE SET NULL)
--   · bookings."flightNumber"  — αριθμός πτήσης (μόνο όταν το σημείο ζητά πτήση)
--   · rate_limits              — μετρητές κατάχρησης για τα δημόσια endpoints
--                                (κλειδί = hash, ΠΟΤΕ IP/email σε καθαρή μορφή)
-- Μόνο προσθήκες, όλες nullable: η παλιά έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "publicCode" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "rentalGroupId" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "flightNumber" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_publicCode_key" ON "bookings" ("publicCode");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_rentalGroupId_fkey') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_rentalGroupId_fkey"
      FOREIGN KEY ("rentalGroupId") REFERENCES "rental_groups" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key"         TEXT         NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count"       INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key", "windowStart")
);

COMMIT;

-- Verification — αναμενόμενο: booking_columns = 3 · public_code_index = 1 · group_fk = 1 · rate_limits_table = 1
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name IN ('publicCode', 'rentalGroupId', 'flightNumber')) AS booking_columns,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'bookings_publicCode_key') AS public_code_index,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'bookings_rentalGroupId_fkey') AS group_fk,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'rate_limits') AS rate_limits_table;
