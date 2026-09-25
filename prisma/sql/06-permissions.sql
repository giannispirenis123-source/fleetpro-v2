-- prisma/sql/06-permissions.sql
--
-- Δικαιώματα ανά χρήστη.
--
-- ΠΡΟΣΟΧΗ: η στήλη users."permissions" ΥΠΑΡΧΕΙ ΗΔΗ (Json, default '{}').
-- Δεν προστίθεται στήλη. Το ADD COLUMN IF NOT EXISTS παρακάτω μένει μόνο
-- για βάσεις που τυχόν ξεκίνησαν από παλιότερο schema — σε βάση που την
-- έχει, δεν κάνει απολύτως τίποτα.
--
-- Αυτό που ΟΝΤΩΣ κάνει το script: δίνει στους ΥΠΑΡΧΟΝΤΕΣ χρήστες τα
-- δικαιώματα που αντιστοιχούν σε ό,τι μπορούσαν να κάνουν ΜΕΧΡΙ ΣΗΜΕΡΑ,
-- ώστε μετά το deploy να μη μείνει κανείς κλειδωμένος έξω.
--
-- Ασφαλές να τρέξει πολλές φορές: πειράζει μόνο χρήστες που δεν έχουν
-- ακόμη κανένα αναγνωρισμένο δικαίωμα.
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → 04 → 05 → 06 → 02-seed

-- ── 1) Η στήλη (υπάρχει ήδη· δικλείδα για παλιές βάσεις) ──
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "permissions" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 2) ΠΡΟΣΩΠΙΚΟ (STAFF): ό,τι έκανε ως τώρα ──
-- Κρατήσεις πλήρως (χωρίς παράκαμψη σύγκρουσης — αυτή ήταν πάντα μόνο του
-- διαχειριστή), πελάτες πλήρως, τιμολόγια, και προβολή σε στόλο και
-- πρόσθετα. ΧΩΡΙΣ Εκπτώσεις και Ρυθμίσεις: μέχρι σήμερα οι σελίδες τους
-- ανακατεύθυναν το Προσωπικό, άρα δεν του τα αφαιρούμε — δεν τα είχε.
UPDATE "users"
SET "permissions" = '{
  "dashboard.view": true,
  "calendar.view": true,
  "bookings.view": true,
  "bookings.create": true,
  "bookings.edit": true,
  "bookings.cancel": true,
  "bookings.status": true,
  "fleet.view": true,
  "extras.view": true,
  "customers.view": true,
  "customers.create": true,
  "customers.edit": true,
  "customers.delete": true,
  "invoices.view": true,
  "invoices.issue": true,
  "invoices.markpaid": true,
  "invoices.print": true
}'::jsonb
WHERE "role" = 'STAFF'
  AND "tenantId" IS NOT NULL
  -- Μόνο όσοι δεν έχουν ήδη δικαίωμα της νέας ονοματολογίας: αν κάποιος
  -- έχει ήδη ρυθμιστεί, δεν του αλλάζουμε τίποτα.
  AND NOT ("permissions" ?| ARRAY['dashboard.view','bookings.view','fleet.view','customers.view','invoices.view','settings.view']);

-- ── 3) ΣΥΝΕΡΓΑΤΕΣ (PARTNER): μόνο προβολή ──
UPDATE "users"
SET "permissions" = '{
  "dashboard.view": true,
  "calendar.view": true,
  "bookings.view": true,
  "fleet.view": true,
  "extras.view": true
}'::jsonb
WHERE "role" = 'PARTNER'
  AND "tenantId" IS NOT NULL
  AND NOT ("permissions" ?| ARRAY['dashboard.view','bookings.view','fleet.view','customers.view','invoices.view','settings.view']);

-- ── 4) Ο διαχειριστής δεν χρειάζεται εγγραφές ──
-- COMPANY_ADMIN και SUPER_ADMIN περνούν πάντα από τον κώδικα, ό,τι κι αν
-- γράφει το πεδίο. Το αδειάζουμε ώστε να μη μένουν παλιά κλειδιά που
-- μπερδεύουν όποιον κοιτάξει τη βάση.
UPDATE "users"
SET "permissions" = '{}'::jsonb
WHERE "role" IN ('COMPANY_ADMIN', 'SUPER_ADMIN')
  AND "permissions" <> '{}'::jsonb;

-- ── Έλεγχος ──
SELECT
  "role",
  count(*)                                              AS "χρήστες",
  count(*) FILTER (WHERE "permissions" <> '{}'::jsonb)  AS "με δικαιώματα"
FROM "users"
GROUP BY "role"
ORDER BY "role";
