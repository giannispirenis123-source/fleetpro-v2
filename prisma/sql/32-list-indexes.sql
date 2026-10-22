-- prisma/sql/32-list-indexes.sql
-- Σελιδοποίηση λιστών του dashboard (PR σταθερότητας): indexes για τη
-- σταθερή ταξινόμηση που χρησιμοποιούν οι σελίδες των 50.
--   · customers: (tenantId, lastName, firstName, id) — αλφαβητικά ανά εταιρία
--   · invoices:  (tenantId, issueDate DESC, id DESC) — νεότερα πρώτα ανά εταιρία
-- Οι κρατήσεις έχουν ήδη (tenantId, createdAt DESC) από το SQL 30.
-- Μόνο indexes: καμία αλλαγή δεδομένων. Idempotent.
-- Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview (η εφαρμογή
-- δουλεύει και χωρίς αυτό, απλώς πιο αργά σε μεγάλες λίστες).

CREATE INDEX IF NOT EXISTS "customers_tenantId_lastName_firstName_id_idx"
  ON "customers" ("tenantId", "lastName", "firstName", "id");

CREATE INDEX IF NOT EXISTS "invoices_tenantId_issueDate_id_idx"
  ON "invoices" ("tenantId", "issueDate" DESC, "id" DESC);

-- Verification — αναμενόμενο: customers_idx = 1 · invoices_idx = 1
SELECT
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'customers_tenantId_lastName_firstName_id_idx') AS customers_idx,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'invoices_tenantId_issueDate_id_idx') AS invoices_idx;
