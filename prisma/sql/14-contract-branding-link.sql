-- prisma/sql/14-contract-branding-link.sql
-- Φάση Β (συνέχεια): λογότυπο εταιρίας + link πελάτη (/c/[token]).
--
-- · tenants."logoPath"               TEXT          διαδρομή στο Storage (tenantId/branding/logo-<τυχαίο>.<ext>)
-- · contracts."publicToken"          TEXT UNIQUE   τυχαίο token του link πελάτη (null = δεν υπάρχει link)
-- · contracts."publicTokenRevokedAt" TIMESTAMP(3)  πότε ακυρώθηκε (null = ενεργό)
--
-- Η λήξη (90 ημέρες μετά την επιστροφή) ΔΕΝ αποθηκεύεται· υπολογίζεται.
-- Οι φωτογραφίες διπλωμάτων ΔΕΝ θέλουν στήλη: ζουν στο JSON των οδηγών
-- (contracts."drivers"[].licensePhotos).
--
-- Idempotent: τρέχει όσες φορές χρειαστεί.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "logoPath" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "publicTokenRevokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "contracts_publicToken_key" ON "contracts"("publicToken");

-- Verification: αναμενόμενο  1 | 2 | 1
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'logoPath') AS tenant_columns,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'contracts'
      AND column_name IN ('publicToken', 'publicTokenRevokedAt')) AS contract_columns,
  (SELECT count(*) FROM pg_indexes
    WHERE tablename = 'contracts' AND indexname = 'contracts_publicToken_key') AS unique_index;
