-- prisma/sql/38-outgoing-amounts.sql
-- Ακεραιότητα ποσών στα μηνύματα προς τον πελάτη (PR price-integrity).
--
-- · booking_notifications."result": νέα τιμή 'blocked' = το μήνυμα ΔΕΝ στάλθηκε
--   γιατί ο έλεγχος ποσών (verifyOutgoingAmounts) βρήκε ασυμφωνία. Ο κωδικός
--   αιτίας μπαίνει στο υπάρχον "error" (π.χ. 'amount:repeated_digits').
-- · booking_notifications."amountCents" (NULL): το σύνολο που περιείχε το
--   μήνυμα — για το «ιστορικό αποστολών» στην κάρτα της κράτησης. Οι παλιές
--   γραμμές μένουν NULL.
--
-- Μόνο προσθήκες/χαλάρωση του CHECK· η σημερινή έκδοση δουλεύει κανονικά.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.
-- (Τα 36/37 ανήκουν στο PR συνδρομών #44 — ανεξάρτητα από αυτό.)

BEGIN;

ALTER TABLE "booking_notifications" ADD COLUMN IF NOT EXISTS "amountCents" INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'booking_notifications_result_check'
       AND pg_get_constraintdef(oid) NOT LIKE '%blocked%'
  ) THEN
    ALTER TABLE "booking_notifications" DROP CONSTRAINT "booking_notifications_result_check";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_notifications_result_check') THEN
    ALTER TABLE "booking_notifications" ADD CONSTRAINT "booking_notifications_result_check"
      CHECK ("result" IN ('sent', 'failed', 'opened', 'blocked'));
  END IF;
END $$;

COMMIT;

-- Verification — αναμενόμενο: amount_column = 1 · result_check_has_blocked = 1 · blocked_rows = 0
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'booking_notifications' AND column_name = 'amountCents') AS amount_column,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'booking_notifications_result_check'
      AND pg_get_constraintdef(oid) LIKE '%blocked%') AS result_check_has_blocked,
  (SELECT count(*) FROM "booking_notifications" WHERE "result" = 'blocked') AS blocked_rows;
