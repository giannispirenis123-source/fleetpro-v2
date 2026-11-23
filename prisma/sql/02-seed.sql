-- ─────────────────────────────────────────────────────────
-- FleetPro v2 — ΒΗΜΑ 2: Αρχικά δεδομένα (seed)
-- Τρέξε ΜΟΝΟ αφού έχει τρέξει επιτυχώς το ΒΗΜΑ 1.
-- Μπορεί να τρέξει ξανά χωρίς πρόβλημα (δεν δημιουργεί διπλά).
-- ─────────────────────────────────────────────────────────

BEGIN;

-- ── Εταιρία (tenant) δοκιμών / demo: Fleet-Pro Car Rental ──
INSERT INTO "tenants" ("id","name","slug","email","phone","address","brandColor","plan","status","updatedAt")
VALUES ('seed_tenant_prentals', 'Fleet-Pro Car Rental', 'p-rentals', 'info@prentals.gr', '2821055555', 'Χανιά, Κρήτη', '#2563EB', 'PRO', 'ACTIVE', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- ── Χρήστες ──
-- Οι κωδικοί είναι κρυπτογραφημένοι με bcrypt (cost 12), όπως τους περιμένει η εφαρμογή.
-- SUPER_ADMIN: ΔΕΝ δημιουργείται εδώ (πριν υπήρχε σταθερός κωδικός στο repo).
-- Φτιάξ' τον με `npm run db:seed` (SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD στο env)
-- ή με INSERT δικό σου με δικό σου bcrypt hash.

-- Demo χρήστες (Διαχειριστής / Προσωπικό / Συνεργάτης): ΔΕΝ δημιουργούνται εδώ.
-- Πριν υπήρχαν σταθεροί κωδικοί (και τα bcrypt hash τους) στο repo.
-- Φτιάξ' τους με `npm run db:seed` και DEMO_PASSWORD (τουλάχιστον 12 χαρακτήρες) στο env,
-- ή από το Super Admin → «Νέα εταιρία» / «Χρήστες» της εφαρμογής.

-- ── Πρότυπο συμβολαίου ──
INSERT INTO "contract_templates" ("id","tenantId","name","content","isDefault","language","updatedAt")
VALUES ('seed_tpl_default', 'seed_tenant_prentals', 'Βασικό Συμβόλαιο Ελ/Αγγλ.', '<div>Βασικό template συμβολαίου. Επεξεργαστείτε από τις Ρυθμίσεις.</div>', true, 'el', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ── Οχήματα ──
INSERT INTO "vehicles" ("id","tenantId","brand","model","plate","year","category","dailyRate","status","km","fuel","seats","images","updatedAt")
VALUES ('seed_veh_1', 'seed_tenant_prentals', 'Toyota', 'Yaris', 'XAΝ-1234', 2022, 'B', 35, 'AVAILABLE', 18500, 'PETROL', 5, ARRAY[]::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("tenantId","plate") DO NOTHING;
INSERT INTO "vehicles" ("id","tenantId","brand","model","plate","year","category","dailyRate","status","km","fuel","seats","images","updatedAt")
VALUES ('seed_veh_2', 'seed_tenant_prentals', 'Volkswagen', 'Polo', 'XAΝ-2345', 2023, 'B', 38, 'AVAILABLE', 9200, 'PETROL', 5, ARRAY[]::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("tenantId","plate") DO NOTHING;
INSERT INTO "vehicles" ("id","tenantId","brand","model","plate","year","category","dailyRate","status","km","fuel","seats","images","updatedAt")
VALUES ('seed_veh_3', 'seed_tenant_prentals', 'Skoda', 'Octavia', 'XAΝ-3456', 2021, 'C', 50, 'AVAILABLE', 41300, 'DIESEL', 5, ARRAY[]::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("tenantId","plate") DO NOTHING;
INSERT INTO "vehicles" ("id","tenantId","brand","model","plate","year","category","dailyRate","status","km","fuel","seats","images","updatedAt")
VALUES ('seed_veh_4', 'seed_tenant_prentals', 'Toyota', 'RAV4', 'XAΝ-4567', 2023, 'SUV', 75, 'AVAILABLE', 12750, 'HYBRID', 5, ARRAY[]::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("tenantId","plate") DO NOTHING;
INSERT INTO "vehicles" ("id","tenantId","brand","model","plate","year","category","dailyRate","status","km","fuel","seats","images","updatedAt")
VALUES ('seed_veh_5', 'seed_tenant_prentals', 'Mercedes', 'A-Class', 'XAΝ-5678', 2022, 'PREMIUM', 95, 'AVAILABLE', 26400, 'PETROL', 5, ARRAY[]::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("tenantId","plate") DO NOTHING;

-- ── Εκπτώσεις ──
INSERT INTO "discounts" ("id","tenantId","code","name","description","type","value","target","isActive","usageLimit","updatedAt")
VALUES ('seed_disc_welcome', 'seed_tenant_prentals', 'WELCOME10', 'Έκπτωση Καλωσορίσματος', '10% για νέους πελάτες', 'PERCENTAGE', 10, 'ALL', true, 100, CURRENT_TIMESTAMP)
ON CONFLICT ("tenantId","code") DO NOTHING;

INSERT INTO "discounts" ("id","tenantId","code","name","description","type","value","target","minDays","isActive","isSeasonal","validFrom","validUntil","updatedAt")
VALUES ('seed_disc_summer', 'seed_tenant_prentals', 'SUMMER25', 'Καλοκαιρινή Προσφορά', '25% έκπτωση για ενοικιάσεις 7+ ημερών', 'PERCENTAGE', 25, 'ALL', 7, true, true, '2025-06-01', '2025-09-30', CURRENT_TIMESTAMP)
ON CONFLICT ("tenantId","code") DO NOTHING;

INSERT INTO "discounts" ("id","tenantId","code","name","description","type","value","target","isActive","isLoyalty","loyaltyMinBookings","updatedAt")
VALUES ('seed_disc_vip', 'seed_tenant_prentals', NULL, 'VIP Loyalty', 'Αυτόματη έκπτωση για πελάτες με 5+ κρατήσεις', 'PERCENTAGE', 15, 'ALL', true, true, 5, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

COMMIT;

-- ── Έλεγχος: πρέπει να δεις 1 εταιρία, 4 χρήστες, 5 οχήματα, 3 εκπτώσεις ──
SELECT
  (SELECT COUNT(*) FROM "tenants")   AS εταιρίες,
  (SELECT COUNT(*) FROM "users")     AS χρήστες,
  (SELECT COUNT(*) FROM "vehicles")  AS οχήματα,
  (SELECT COUNT(*) FROM "discounts") AS εκπτώσεις;
