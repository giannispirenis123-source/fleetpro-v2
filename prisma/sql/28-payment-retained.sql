-- prisma/sql/28-payment-retained.sql
-- «Το υπόλοιπο κρατείται (χρέωση ακύρωσης)»: σε ακυρωμένη κράτηση με online
-- πληρωμή η εταιρία μπορεί να κρατήσει ό,τι δεν επέστρεψε. Καταγράφεται στο
-- booking_payments (ποσό, πότε, σημείωση, ποιος). Ισχύει πάντα:
-- refundedCents + retainedCents <= amountCents.
-- Μόνο προσθήκες (με προεπιλογές)· η παλιά έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

ALTER TABLE "booking_payments" ADD COLUMN IF NOT EXISTS "retainedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "booking_payments" ADD COLUMN IF NOT EXISTS "retainedAt"    TIMESTAMP(3);
ALTER TABLE "booking_payments" ADD COLUMN IF NOT EXISTS "retainedNote"  TEXT;
ALTER TABLE "booking_payments" ADD COLUMN IF NOT EXISTS "retainedBy"    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_retained_check') THEN
    ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_retained_check"
      CHECK ("retainedCents" >= 0 AND "refundedCents" + "retainedCents" <= "amountCents");
  END IF;
END $$;

COMMIT;

-- ── Επαλήθευση (αναμενόμενο: 4 | 1 | 0) ──
--   νέες στήλες | constraint | γραμμές που παραβιάζουν το όριο
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'booking_payments' AND column_name IN ('retainedCents','retainedAt','retainedNote','retainedBy')) AS new_columns,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'booking_payments_retained_check') AS retained_check,
  (SELECT count(*) FROM "booking_payments" WHERE "refundedCents" + "retainedCents" > "amountCents") AS violations;
