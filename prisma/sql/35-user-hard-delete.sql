-- prisma/sql/35-user-hard-delete.sql
-- Οριστική διαγραφή χρήστη από τη σελίδα «Χρήστες».
-- Οι ιστορικές εγγραφές ΜΕΝΟΥΝ· το πεδίο του χρήστη γίνεται κενό και η
-- εφαρμογή δείχνει «Διαγραμμένος χρήστης» (ποτέ όνομα/email).
--   · activity_logs."userId": γίνεται NULLABLE και το FK γίνεται ON DELETE
--     SET NULL (σήμερα RESTRICT: όποιος έχει ιστορικό δεν διαγράφεται).
--   · bookings."createdById" / "partnerId": το FK γίνεται (ή μένει) ON DELETE
--     SET NULL· νέα σημάδια "createdByDeleted" / "partnerDeleted", ώστε να
--     ξεχωρίζει ο διαγραμμένος από τις κρατήσεις του site / τις παλιές.
--   · contracts."createdByDeleted": το όνομα (snapshot) σβήνεται στη διαγραφή.
-- Μόνο προσθήκες/χαλαρώσεις· η σημερινή έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

-- 1) activity_logs.userId: NULL επιτρέπεται + ON DELETE SET NULL.
ALTER TABLE "activity_logs" ALTER COLUMN "userId" DROP NOT NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_logs_userId_fkey' AND confdeltype <> 'n') THEN
    ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_userId_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_logs_userId_fkey') THEN
    ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) bookings: FK ON DELETE SET NULL (ήδη από το SQL 07 — εδώ για σιγουριά) + σημάδια.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_createdById_fkey' AND confdeltype <> 'n') THEN
    ALTER TABLE "bookings" DROP CONSTRAINT "bookings_createdById_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_createdById_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_partnerId_fkey' AND confdeltype <> 'n') THEN
    ALTER TABLE "bookings" DROP CONSTRAINT "bookings_partnerId_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_partnerId_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_partnerId_fkey"
      FOREIGN KEY ("partnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "createdByDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "partnerDeleted" BOOLEAN NOT NULL DEFAULT false;

-- 3) contracts: σημάδι «ο συντάκτης διαγράφηκε».
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "createdByDeleted" BOOLEAN NOT NULL DEFAULT false;

COMMIT;

-- Verification — αναμενόμενο: activity_nullable = YES · fk_set_null = 3 · new_columns = 3 · flagged_rows = 0
SELECT
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'activity_logs' AND column_name = 'userId') AS activity_nullable,
  (SELECT count(*) FROM pg_constraint
    WHERE conname IN ('activity_logs_userId_fkey', 'bookings_createdById_fkey', 'bookings_partnerId_fkey')
      AND confdeltype = 'n') AS fk_set_null,
  (SELECT count(*) FROM information_schema.columns
    WHERE (table_name = 'bookings' AND column_name IN ('createdByDeleted', 'partnerDeleted'))
       OR (table_name = 'contracts' AND column_name = 'createdByDeleted')) AS new_columns,
  (SELECT count(*) FROM "bookings" WHERE "createdByDeleted" OR "partnerDeleted")
    + (SELECT count(*) FROM "contracts" WHERE "createdByDeleted") AS flagged_rows;
