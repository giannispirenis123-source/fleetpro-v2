-- prisma/sql/22-unified-pricing.sql
-- Ενιαία τιμολόγηση (dashboard = δημόσιο site): κάθε ΝΕΑ κράτηση/συμβόλαιο
-- κρατά ολόκληρη την ανάλυση της quote() και αν η τιμή ήταν αυτόματη ή
-- χειροκίνητη. Οι υπάρχουσες κρατήσεις μένουν NULL (δεν αγγίζονται).
--
-- Idempotent: τρέχει όσες φορές χρειαστεί. Τρέχει στο Supabase SQL Editor
-- ΠΡΙΝ από τη δοκιμή στο preview (το preview γράφει στην ίδια βάση).

BEGIN;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "priceQuote" JSONB;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "priceMode" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_priceMode_check') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_priceMode_check"
      CHECK ("priceMode" IS NULL OR "priceMode" IN ('AUTO', 'MANUAL'));
  END IF;
END $$;

COMMIT;

-- Verification — αναμενόμενο: new_columns = 2 · price_mode_check = 1 · old_bookings_touched = 0
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name IN ('priceQuote', 'priceMode')) AS new_columns,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'bookings_priceMode_check') AS price_mode_check,
  (SELECT count(*) FROM "bookings"
    WHERE "createdAt" < now() - interval '1 minute' AND ("priceQuote" IS NOT NULL OR "priceMode" IS NOT NULL)) AS old_bookings_touched;
