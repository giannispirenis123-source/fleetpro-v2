-- prisma/sql/19-invoice-pdf.sql
-- Τιμολόγια: τυχαίος κωδικός (π.χ. K7M2-X9PQ) + αποστολή με email (PDF).
--
-- · invoices."invoiceCode"   TEXT NULL, UNIQUE σε ΟΛΗ τη βάση
--     Αυτό εμφανίζεται σε οθόνες, PDF και email. Ο παλιός αριθμός
--     (invoiceNumber, INV-001…) ΜΕΝΕΙ όπως είναι — δεν σβήνεται.
--     Backfill για όσα τιμολόγια δεν έχουν κωδικό (μόνο όπου IS NULL).
-- · invoices."emailSentAt"   TIMESTAMP(3) NULL  τελευταία επιτυχής αποστολή
-- · invoices."emailSentTo"   TEXT NULL          σε ποιο email
-- · invoices."emailSendLog"  JSONB NOT NULL DEFAULT '[]'
--     ιστορικό ΟΛΩΝ των προσπαθειών [{ id, at, ok, lang, to, by, error? }]
--     (το "to" μασκαρισμένο). Από εδώ μετρά το όριο 5 αποστολές/ώρα.
--
-- Idempotent: τρέχει όσες φορές χρειαστεί. Τρέξτε το ΠΡΙΝ δοκιμάσετε το
-- preview (γράφει στην ίδια βάση με την παραγωγή) και ξανά μία φορά μετά
-- το merge, ώστε να πάρουν κωδικό και τιμολόγια που έβγαλε στο μεταξύ η
-- παλιά έκδοση (η εφαρμογή τούς δίνει κωδικό και μόνη της με την πρώτη
-- λήψη PDF/αποστολή).

-- ── 1) Στήλες ──
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoiceCode" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "emailSentAt" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "emailSentTo" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "emailSendLog" JSONB NOT NULL DEFAULT '[]';

-- ── 2) Μοναδικότητα σε όλη τη βάση (πολλά NULL επιτρέπονται) ──
-- Το όνομα είναι αυτό που περιμένει το Prisma για @unique.
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoiceCode_key" ON "invoices" ("invoiceCode");

-- ── 3) Backfill: κωδικός ΜΟΝΟ όπου λείπει ──
-- Ίδιο αλφάβητο με το src/lib/invoiceCode.ts (32 χαρακτήρες, χωρίς O/0/I/1),
-- μορφή XXXX-XXXX. Τυχαιότητα από gen_random_uuid() (κρυπτογραφική, χωρίς
-- επέκταση): 8 bytes από τα καθαρά τυχαία του UUID v4 (όχι τα bytes 6 και 8,
-- που κρατούν version/variant)· byte % 32 χωρίς μεροληψία (256 = 8 × 32).
-- Σε σύγκρουση με υπάρχοντα κωδικό ξαναδοκιμάζει με νέο.
DO $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  positions CONSTANT INT[] := ARRAY[0, 1, 2, 3, 4, 5, 9, 10];
  r RECORD;
  bytes BYTEA;
  code TEXT;
  i INT;
  tries INT;
BEGIN
  FOR r IN SELECT "id" FROM "invoices" WHERE "invoiceCode" IS NULL LOOP
    tries := 0;
    LOOP
      tries := tries + 1;
      bytes := uuid_send(gen_random_uuid());
      code := '';
      FOR i IN 1..8 LOOP
        IF i = 5 THEN code := code || '-'; END IF;
        code := code || substr(alphabet, (get_byte(bytes, positions[i]) % 32) + 1, 1);
      END LOOP;
      BEGIN
        UPDATE "invoices" SET "invoiceCode" = code
        WHERE "id" = r."id" AND "invoiceCode" IS NULL;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF tries >= 20 THEN RAISE; END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- ── Verification: αναμενόμενο  0 | 0 | 0 | 4 | 1 ──
--   without_code   τιμολόγια χωρίς κωδικό (πρέπει 0)
--   duplicate      κωδικοί που εμφανίζονται >1 φορά (πρέπει 0)
--   bad_format     κωδικοί εκτός μορφής XXXX-XXXX / αλφαβήτου (πρέπει 0)
--   new_columns    invoiceCode, emailSentAt, emailSentTo, emailSendLog (πρέπει 4)
--   unique_index   ο μοναδικός δείκτης (πρέπει 1)
SELECT
  (SELECT count(*) FROM "invoices" WHERE "invoiceCode" IS NULL) AS without_code,
  (SELECT count(*) FROM (
     SELECT "invoiceCode" FROM "invoices"
     WHERE "invoiceCode" IS NOT NULL
     GROUP BY "invoiceCode" HAVING count(*) > 1
   ) d) AS duplicate,
  (SELECT count(*) FROM "invoices"
     WHERE "invoiceCode" IS NOT NULL
       AND "invoiceCode" !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$') AS bad_format,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'invoices'
       AND column_name IN ('invoiceCode', 'emailSentAt', 'emailSentTo', 'emailSendLog')) AS new_columns,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'invoices_invoiceCode_key') AS unique_index;
