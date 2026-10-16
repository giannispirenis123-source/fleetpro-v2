-- prisma/sql/24-booking-confirm-cancel.sql
-- Επιβεβαίωση / ακύρωση κράτησης και μήνυμα στον πελάτη.
--   · bookings."siteLang"         — γλώσσα του site τη στιγμή της υποβολής ('el', 'en', …).
--                                   NULL = παλιά κράτηση → προεπιλεγμένη γλώσσα της εταιρίας.
--   · bookings."cancelReasonCode" — λόγος ακύρωσης από τη λίστα (π.χ. 'no_vehicle'), ή NULL
--   · bookings."cancelNote"       — ελεύθερο κείμενο του διαχειριστή για τον πελάτη, ή NULL
--   · booking_notifications       — κάθε αποστολή μηνύματος (email / WhatsApp / mailto):
--                                   τύπος, κανάλι, αποτέλεσμα, κωδικός σφάλματος.
--                                   ΚΑΝΕΝΑ προσωπικό στοιχείο (όχι email, όχι τηλέφωνο).
-- Μόνο προσθήκες, όλες nullable: η παλιά έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "siteLang" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancelReasonCode" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancelNote" TEXT;

CREATE TABLE IF NOT EXISTS "booking_notifications" (
  "id"        TEXT         NOT NULL,
  "tenantId"  TEXT         NOT NULL,
  "bookingId" TEXT         NOT NULL,
  "kind"      TEXT         NOT NULL,
  "channel"   TEXT         NOT NULL,
  "result"    TEXT         NOT NULL,
  "error"     TEXT,
  "lang"      TEXT,
  "userId"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "booking_notifications_tenantId_bookingId_idx"
  ON "booking_notifications" ("tenantId", "bookingId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_notifications_bookingId_fkey') THEN
    ALTER TABLE "booking_notifications"
      ADD CONSTRAINT "booking_notifications_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "bookings" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_notifications_tenantId_fkey') THEN
    ALTER TABLE "booking_notifications"
      ADD CONSTRAINT "booking_notifications_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_notifications_kind_check') THEN
    ALTER TABLE "booking_notifications"
      ADD CONSTRAINT "booking_notifications_kind_check" CHECK ("kind" IN ('confirm', 'cancel'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_notifications_channel_check') THEN
    ALTER TABLE "booking_notifications"
      ADD CONSTRAINT "booking_notifications_channel_check" CHECK ("channel" IN ('email', 'whatsapp', 'mailto'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_notifications_result_check') THEN
    ALTER TABLE "booking_notifications"
      ADD CONSTRAINT "booking_notifications_result_check" CHECK ("result" IN ('sent', 'failed', 'opened'));
  END IF;
END $$;

COMMIT;

-- Verification — αναμενόμενο: booking_columns = 3 · notifications_table = 1 · notifications_fks = 2 · notifications_checks = 3
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name IN ('siteLang', 'cancelReasonCode', 'cancelNote')) AS booking_columns,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'booking_notifications') AS notifications_table,
  (SELECT count(*) FROM pg_constraint
    WHERE conname IN ('booking_notifications_bookingId_fkey', 'booking_notifications_tenantId_fkey')) AS notifications_fks,
  (SELECT count(*) FROM pg_constraint
    WHERE conname IN ('booking_notifications_kind_check', 'booking_notifications_channel_check', 'booking_notifications_result_check')) AS notifications_checks;
