-- prisma/sql/29-contract-payment.sql
-- Πληρωμή ενοικίου του ΣΥΜΒΟΛΑΙΟΥ με κάρτα μέσω Stripe Connect (Checkout,
-- link + QR στο κινητό του πελάτη). Ξαναχρησιμοποιεί το booking_payments του
-- PR #29 (ίδιο webhook, ίδιες επιστροφές)· η νέα στήλη "purpose" ξεχωρίζει:
--   BOOKING  = online πληρωμή της κράτησης από το δημόσιο site (όλες οι υπάρχουσες)
--   CONTRACT = πληρωμή του ενοικίου από το συμβόλαιο
-- Μόνο προσθήκη με προεπιλογή· η παλιά έκδοση (production) δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

ALTER TABLE "booking_payments" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'BOOKING';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_purpose_check') THEN
    ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_purpose_check"
      CHECK ("purpose" IN ('BOOKING', 'CONTRACT'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "booking_payments_tenantId_bookingId_purpose_idx"
  ON "booking_payments" ("tenantId", "bookingId", "purpose");

COMMIT;

-- ── Επαλήθευση (αναμενόμενο: 1 | 1 | 1 | 0) ──
--   νέα στήλη | constraint | index | γραμμές με άλλη τιμή από BOOKING
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'booking_payments' AND column_name = 'purpose') AS new_column,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'booking_payments_purpose_check') AS purpose_check,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'booking_payments_tenantId_bookingId_purpose_idx') AS purpose_index,
  (SELECT count(*) FROM "booking_payments" WHERE "purpose" <> 'BOOKING') AS non_booking_rows;
