-- ─────────────────────────────────────────────────────────
-- FleetPro v2 — ΒΗΜΑ 2: Αρχικά δεδομένα (seed)
-- Τρέξε ΜΟΝΟ αφού έχει τρέξει επιτυχώς το ΒΗΜΑ 1.
-- Μπορεί να τρέξει ξανά χωρίς πρόβλημα (δεν δημιουργεί διπλά).
-- ─────────────────────────────────────────────────────────

BEGIN;

-- ── Εταιρία (tenant): P Rentals Χανιά ──
INSERT INTO "tenants" ("id","name","slug","email","phone","address","brandColor","plan","status","updatedAt")
VALUES ('seed_tenant_prentals', 'P Rentals Χανιά', 'p-rentals', 'info@prentals.gr', '2821055555', 'Χανιά, Κρήτη', '#2563EB', 'PRO', 'ACTIVE', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- ── Χρήστες ──
-- Οι κωδικοί είναι κρυπτογραφημένοι με bcrypt (cost 12), όπως τους περιμένει η εφαρμογή.
-- SUPER_ADMIN: superadmin@fleetpro.gr / FleetPro2025!
INSERT INTO "users" ("id","tenantId","name","email","passwordHash","role","permissions","updatedAt")
VALUES ('seed_user_superadmin', NULL, 'Super Administrator', 'superadmin@fleetpro.gr', '$2a$12$3QzexkSlmzZVczgKLVR8qeHflTBPAEP6osxiGkYc4zTx.t9DLg2ou', 'SUPER_ADMIN', '{}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO NOTHING;

-- COMPANY_ADMIN: admin@prentals.gr / Admin2025!
INSERT INTO "users" ("id","tenantId","name","email","passwordHash","role","permissions","updatedAt")
VALUES ('seed_user_admin', 'seed_tenant_prentals', 'Παναγιώτης Κ.', 'admin@prentals.gr', '$2a$12$4d764Wrsi5lne2CVGw5sqOCvEOqCgYgPmWhnkaOe8Gd8XgDd5uXLy', 'COMPANY_ADMIN', '{}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO NOTHING;

-- STAFF: staff@prentals.gr / Staff2025!
INSERT INTO "users" ("id","tenantId","name","email","passwordHash","role","permissions","updatedAt")
VALUES ('seed_user_staff', 'seed_tenant_prentals', 'Μαρία Π.', 'staff@prentals.gr', '$2a$12$SueFOKt7tvwEioHVYQRGkOm0vRzOQ4l2QMPtbOA.VNzry5B8t6FEu', 'STAFF', '{"viewBookings":true,"manageBookings":true,"viewContracts":true,"manageContracts":true,"viewInvoices":true,"manageInvoices":false,"viewFleet":true,"manageFleet":false,"viewService":true,"manageService":true,"viewCustomers":true,"manageCustomers":true,"viewReports":false,"viewFinance":false,"viewCalendar":true,"manageDamages":true,"manageDiscounts":false}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO NOTHING;

-- PARTNER: partner@prentals.gr / Partner2025!
INSERT INTO "users" ("id","tenantId","name","email","passwordHash","role","permissions","updatedAt")
VALUES ('seed_user_partner', 'seed_tenant_prentals', 'Αλέξης Σ.', 'partner@prentals.gr', '$2a$12$f67A.kO/HOct0RfQkUBGIO6tj06iWfOUimgmBuQz6OH.jZR9./9Yu', 'PARTNER', '{"viewBookings":true,"viewFleet":true,"viewCalendar":true}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO NOTHING;

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
