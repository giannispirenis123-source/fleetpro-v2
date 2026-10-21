-- prisma/sql/30-booking-number-unique.sql
-- Κλείσιμο του audit 10/2026:
--   1) UNIQUE αριθμός κράτησης ανά εταιρία: bookings("tenantId", "bookingNumber").
--      ΜΟΝΟ αν δεν υπάρχουν ήδη διπλότυπα. Αν υπάρχουν, ΔΕΝ αποτυγχάνει: γράφει
--      NOTICE, δεν βάζει το UNIQUE, και το verification δείχνει πόσα βρέθηκαν.
--   2) Τα indexes του audit για ό,τι τρέχει σήμερα (συγκρούσεις οχήματος,
--      καταστάσεις/ημερομηνίες, λίστες, ιστορικό, καθάρισμα rate_limits).
-- Μόνο προσθήκες (indexes)· καμία αλλαγή σε δεδομένα. Idempotent.
-- Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.
--
-- Έλεγχος διπλότυπων ΠΡΙΝ (αναμενόμενο: 0 γραμμές):
--   SELECT "tenantId", "bookingNumber", count(*) AS copies
--   FROM "bookings" GROUP BY "tenantId", "bookingNumber"
--   HAVING count(*) > 1 ORDER BY copies DESC;

BEGIN;

DO $$
DECLARE
  dupes integer;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT 1 FROM "bookings" GROUP BY "tenantId", "bookingNumber" HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE NOTICE 'Βρέθηκαν % διπλότυποι αριθμοί κράτησης: το UNIQUE ΔΕΝ μπήκε. Τρέξτε την ερώτηση ελέγχου και στείλτε το αποτέλεσμα.', dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "bookings_tenantId_bookingNumber_key"
      ON "bookings" ("tenantId", "bookingNumber");
  END IF;
END $$;

-- Συγκρούσεις οχήματος (dashboard, site, walk-in) και κατάσταση οχήματος.
CREATE INDEX IF NOT EXISTS "bookings_tenantId_vehicleId_status_idx"
  ON "bookings" ("tenantId", "vehicleId", "status");
-- Διαθεσιμότητα / μετρήσεις Πίνακα / εκκρεμή από το site.
CREATE INDEX IF NOT EXISTS "bookings_tenantId_status_pickupDate_idx"
  ON "bookings" ("tenantId", "status", "pickupDate");
-- Λίστα κρατήσεων και «πρόσφατες».
CREATE INDEX IF NOT EXISTS "bookings_tenantId_createdAt_idx"
  ON "bookings" ("tenantId", "createdAt" DESC);
-- Λίστα συμβολαίων.
CREATE INDEX IF NOT EXISTS "contracts_tenantId_createdAt_idx"
  ON "contracts" ("tenantId", "createdAt" DESC);
-- Ιστορικό ανά εγγραφή («Εμφάνιση» κάρτας, ενέργειες κράτησης, κλείδωμα login).
CREATE INDEX IF NOT EXISTS "activity_logs_tenantId_entity_entityId_createdAt_idx"
  ON "activity_logs" ("tenantId", "entity", "entityId", "createdAt" DESC);
-- Καθάρισμα παλιών παραθύρων του rate_limits.
CREATE INDEX IF NOT EXISTS "rate_limits_windowStart_idx"
  ON "rate_limits" ("windowStart");

COMMIT;

-- ── Επαλήθευση (αναμενόμενο: 0 | 1 | 6) ──
--   διπλότυποι αριθμοί | UNIQUE αριθμού κράτησης | νέα indexes
SELECT
  (SELECT count(*) FROM (SELECT 1 FROM "bookings" GROUP BY "tenantId", "bookingNumber" HAVING count(*) > 1) d) AS duplicate_numbers,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'bookings_tenantId_bookingNumber_key') AS booking_number_unique,
  (SELECT count(*) FROM pg_indexes WHERE indexname IN (
     'bookings_tenantId_vehicleId_status_idx',
     'bookings_tenantId_status_pickupDate_idx',
     'bookings_tenantId_createdAt_idx',
     'contracts_tenantId_createdAt_idx',
     'activity_logs_tenantId_entity_entityId_createdAt_idx',
     'rate_limits_windowStart_idx')) AS new_indexes;
