-- prisma/sql/05-invoices.sql
--
-- Τιμολόγια Βήμα 1: ρυθμίσεις τιμολόγησης ανά εταιρία + μοναδικός αριθμός
-- τιμολογίου ανά εταιρία + πεδίο αποστολής.
--
-- Ασφαλές να τρέξει πολλές φορές (IF NOT EXISTS / DO blocks).
-- ΔΕΝ αλλάζει καμία υπάρχουσα εγγραφή: κάθε εταιρία ξεκινά με ΦΠΑ 24%,
-- αυτόματη έκδοση με το τέλος της ενοικίασης και χειροκίνητη αποστολή.
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → 04 → 05 → 02-seed

-- ── 1) Enums ──
-- Η PostgreSQL δεν υποστηρίζει CREATE TYPE IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvoiceIssueTrigger') THEN
    CREATE TYPE "InvoiceIssueTrigger" AS ENUM ('ON_COMPLETION', 'ON_CONTRACT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvoiceSendMode') THEN
    CREATE TYPE "InvoiceSendMode" AS ENUM ('AUTO', 'MANUAL');
  END IF;
END $$;

-- ── 2) Ρυθμίσεις τιμολόγησης ανά εταιρία ──
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS "invoiceIssueTrigger" "InvoiceIssueTrigger" NOT NULL DEFAULT 'ON_COMPLETION',
  ADD COLUMN IF NOT EXISTS "invoiceSendMode" "InvoiceSendMode" NOT NULL DEFAULT 'MANUAL';

-- ── 3) Πότε στάλθηκε το τιμολόγιο (η αποστολή έρχεται σε επόμενο βήμα) ──
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);

-- ── 4) Ο αριθμός τιμολογίου μοναδικός ΜΕΣΑ στην εταιρία ──
-- Αυτό το constraint είναι που κάνει ασφαλή την ταυτόχρονη έκδοση:
-- δύο παράλληλες εκδόσεις δεν μπορούν να πάρουν τον ίδιο αριθμό.
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenantId_invoiceNumber_key"
  ON "invoices" ("tenantId", "invoiceNumber");

-- Έλεγχος
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'tenants' AND column_name IN
       ('vatRate','invoiceIssueTrigger','invoiceSendMode'))            AS "tenants (3)",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'invoices' AND column_name = 'sentAt')         AS "invoices.sentAt",
  (SELECT count(*) FROM pg_indexes
     WHERE indexname = 'invoices_tenantId_invoiceNumber_key')          AS "unique index";
