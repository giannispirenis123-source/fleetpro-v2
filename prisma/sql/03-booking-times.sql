-- prisma/sql/03-booking-times.sql
--
-- Ώρες παραλαβής/επιστροφής στην κράτηση + χρόνος προετοιμασίας ανά εταιρία.
--
-- Ασφαλές να τρέξει πολλές φορές (IF NOT EXISTS).
-- ΔΕΝ αγγίζει υπάρχουσες εγγραφές: οι παλιές κρατήσεις μένουν χωρίς ώρες
-- (NULL) και κάθε εταιρία ξεκινά με χρόνο προετοιμασίας 0 λεπτά.

-- 1) Χρόνος προετοιμασίας οχήματος, σε λεπτά, ανά εταιρία.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "prepTimeMinutes" INTEGER NOT NULL DEFAULT 0;

-- 2) Ώρα παραλαβής και ώρα επιστροφής, ως κείμενο "HH:mm".
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "pickupTime" TEXT,
  ADD COLUMN IF NOT EXISTS "returnTime" TEXT;

-- Έλεγχος
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'tenants' AND column_name = 'prepTimeMinutes')  AS "tenants.prepTimeMinutes",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'bookings' AND column_name = 'pickupTime')      AS "bookings.pickupTime",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'bookings' AND column_name = 'returnTime')      AS "bookings.returnTime";
