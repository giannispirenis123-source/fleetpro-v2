-- prisma/sql/17-contract-email-sent.sql
-- Αποστολή συμβολαίου στον πελάτη (email + PDF μέσω Resend).
--
-- · contracts."emailSentAt"   TIMESTAMP(3) NULL  πότε στάλθηκε τελευταία φορά (επιτυχία)
-- · contracts."emailSentTo"   TEXT NULL          σε ποιο email (κύριος οδηγός)
-- · contracts."emailSendLog"  JSONB NOT NULL DEFAULT '[]'
--     ιστορικό ΟΛΩΝ των προσπαθειών [{ id, at, ok, lang, to, by, error? }]
--     (το "to" μασκαρισμένο). Από εδώ μετρά το όριο 5 αποστολές/ώρα.
--
-- Idempotent: τρέχει όσες φορές χρειαστεί. Προϋπόθεση: έχει τρέξει το 16.

ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "emailSentAt" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "emailSentTo" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "emailSendLog" JSONB NOT NULL DEFAULT '[]';

-- Verification: αναμενόμενο  3 | 1
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'contracts'
      AND column_name IN ('emailSentAt', 'emailSentTo', 'emailSendLog')) AS email_columns,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'cardNumberEnc') AS sql16_card_number;
