-- prisma/sql/10-finance.sql
--
-- Οικονομικά: έξοδα + σύνοψη έσοδα / έξοδα / κέρδος.
--
-- ΠΡΟΣΟΧΗ: ο πίνακας "expenses" ΥΠΑΡΧΕΙ ΗΔΗ από το 01-schema (με
-- "vehicleId" nullable και ON DELETE SET NULL), όπως και ο "invoices".
-- Κανένας πίνακας, στήλη ή enum δεν δημιουργείται. Το "type" των εξόδων
-- μένει ελεύθερο κείμενο· οι επιτρεπτές τιμές ελέγχονται στο API.
--
-- Αυτό που ΟΝΤΩΣ λείπει και προστίθεται εδώ:
--   · indexes για τα φίλτρα της σελίδας (διάστημα, όχημα)
--   · index για τα έσοδα διαστήματος (εξοφλημένα τιμολόγια ανά paidAt)
--   · το παλιό δικαίωμα "finance.expense" μετονομάζεται σε "finance.create"
--     ΜΟΝΟ για όσους το είχαν ήδη ρητά. Κανείς άλλος δεν παίρνει
--     δικαιώματα οικονομικών αυτόματα (ο διαχειριστής τα έχει πάντα).
--
-- Ασφαλές να τρέξει πολλές φορές.
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → … → 09 → 10,
-- και το 02-seed οποτεδήποτε μετά το 01-schema.

-- ── 1) Indexes εξόδων ──
CREATE INDEX IF NOT EXISTS "expenses_tenantId_date_idx"
  ON "expenses" ("tenantId", "date");

CREATE INDEX IF NOT EXISTS "expenses_tenantId_vehicleId_idx"
  ON "expenses" ("tenantId", "vehicleId");

-- ── 2) Index εσόδων ──
CREATE INDEX IF NOT EXISTS "invoices_tenantId_status_paidAt_idx"
  ON "invoices" ("tenantId", "status", "paidAt");

-- ── 3) Δικαιώματα: finance.expense → finance.create ──
-- Μόνο όποιος το είχε ήδη ενεργό. Το παλιό κλειδί αφαιρείται.
UPDATE "users"
SET "permissions" = ("permissions" - 'finance.expense')
                    || '{"finance.create": true}'::jsonb
WHERE "permissions" ? 'finance.expense'
  AND "permissions" ->> 'finance.expense' = 'true';

-- Όπου υπήρχε ως false, απλώς καθαρίζεται.
UPDATE "users"
SET "permissions" = "permissions" - 'finance.expense'
WHERE "permissions" ? 'finance.expense';

-- ── Έλεγχος ── (αναμενόμενο: 3 | 0)
SELECT
  (SELECT count(*) FROM pg_indexes WHERE indexname IN (
     'expenses_tenantId_date_idx',
     'expenses_tenantId_vehicleId_idx',
     'invoices_tenantId_status_paidAt_idx'))                        AS "indexes (3)",
  (SELECT count(*) FROM "users"
     WHERE "permissions" ? 'finance.expense')                       AS "παλιό finance.expense (0)";
