// prisma/seed.ts
// Seed script — δημιουργεί Super Admin + demo tenants

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Ξεκινά το seeding...");

  // ── 1. Super Admin ─────────────────────
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || "superadmin@fleetpro.gr";
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || "FleetPro2025!";

  const existingSuperAdmin = await prisma.user.findUnique({
    where: { email: superAdminEmail },
  });

  if (!existingSuperAdmin) {
    await prisma.user.create({
      data: {
        name: "Super Administrator",
        email: superAdminEmail,
        passwordHash: await bcrypt.hash(superAdminPassword, 12),
        role: "SUPER_ADMIN",
        tenantId: null,
        permissions: {},
      },
    });
    console.log(`✅ Super Admin: ${superAdminEmail}`);
  } else {
    console.log(`ℹ️  Super Admin υπάρχει ήδη: ${superAdminEmail}`);
  }

  // ── 2. Demo Tenant: P Rentals ──────────
  const existingTenant = await prisma.tenant.findUnique({
    where: { slug: "p-rentals" },
  });

  if (!existingTenant) {
    const tenant = await prisma.tenant.create({
      data: {
        name: "P Rentals Χανιά",
        slug: "p-rentals",
        email: "info@prentals.gr",
        phone: "2821055555",
        address: "Χανιά, Κρήτη",
        brandColor: "#2563EB",
        plan: "PRO",
        status: "ACTIVE",
      },
    });

    // Company Admin
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Παναγιώτης Κ.",
        email: "admin@prentals.gr",
        passwordHash: await bcrypt.hash("Admin2025!", 12),
        role: "COMPANY_ADMIN",
        permissions: {},
      },
    });

    // Staff
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Μαρία Π.",
        email: "staff@prentals.gr",
        passwordHash: await bcrypt.hash("Staff2025!", 12),
        role: "STAFF",
        permissions: {
          viewBookings: true,
          manageBookings: true,
          viewContracts: true,
          manageContracts: true,
          viewInvoices: true,
          manageInvoices: false,
          viewFleet: true,
          manageFleet: false,
          viewService: true,
          manageService: true,
          viewCustomers: true,
          manageCustomers: true,
          viewReports: false,
          viewFinance: false,
          viewCalendar: true,
          manageDamages: true,
          manageDiscounts: false,
        },
      },
    });

    // Partner
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Αλέξης Σ.",
        email: "partner@prentals.gr",
        passwordHash: await bcrypt.hash("Partner2025!", 12),
        role: "PARTNER",
        permissions: {
          viewBookings: true,
          viewFleet: true,
          viewCalendar: true,
        },
      },
    });

    // Default Contract Template
    await prisma.contractTemplate.create({
      data: {
        tenantId: tenant.id,
        name: "Βασικό Συμβόλαιο Ελ/Αγγλ.",
        isDefault: true,
        language: "el",
        content: getDefaultTemplate(),
      },
    });

    // Demo vehicles
    const vehicles = [
      { brand: "Toyota", model: "Yaris", plate: "XAΝ-1234", year: 2022, category: "B" as const, dailyRate: 35, fuel: "PETROL" as const },
      { brand: "Volkswagen", model: "Polo", plate: "XAΝ-2345", year: 2023, category: "B" as const, dailyRate: 38, fuel: "PETROL" as const },
      { brand: "Skoda", model: "Octavia", plate: "XAΝ-3456", year: 2021, category: "C" as const, dailyRate: 50, fuel: "DIESEL" as const },
      { brand: "Toyota", model: "RAV4", plate: "XAΝ-4567", year: 2023, category: "SUV" as const, dailyRate: 75, fuel: "HYBRID" as const },
      { brand: "Mercedes", model: "A-Class", plate: "XAΝ-5678", year: 2022, category: "PREMIUM" as const, dailyRate: 95, fuel: "PETROL" as const },
    ];

    for (const v of vehicles) {
      await prisma.vehicle.create({
        data: {
          tenantId: tenant.id,
          ...v,
          status: "AVAILABLE",
          km: Math.floor(Math.random() * 50000),
          seats: v.category === "SUV" ? 5 : v.category === "B" ? 5 : 5,
        },
      });
    }

    // Demo discounts
    await prisma.discount.createMany({
      data: [
        {
          tenantId: tenant.id,
          code: "WELCOME10",
          name: "Έκπτωση Καλωσορίσματος",
          description: "10% για νέους πελάτες",
          type: "PERCENTAGE",
          value: 10,
          target: "ALL",
          isActive: true,
          usageLimit: 100,
        },
        {
          tenantId: tenant.id,
          code: "SUMMER25",
          name: "Καλοκαιρινή Προσφορά",
          description: "25% έκπτωση για ενοικιάσεις 7+ ημερών",
          type: "PERCENTAGE",
          value: 25,
          target: "ALL",
          minDays: 7,
          isActive: true,
          isSeasonal: true,
          validFrom: new Date("2025-06-01"),
          validUntil: new Date("2025-09-30"),
        },
        {
          tenantId: tenant.id,
          name: "VIP Loyalty",
          description: "Αυτόματη έκπτωση για πελάτες με 5+ κρατήσεις",
          type: "PERCENTAGE",
          value: 15,
          target: "ALL",
          isActive: true,
          isLoyalty: true,
          loyaltyMinBookings: 5,
        },
      ],
    });

    console.log(`✅ Demo Tenant: P Rentals (${tenant.id})`);
    console.log(`   👤 Admin: admin@prentals.gr / Admin2025!`);
    console.log(`   👤 Staff: staff@prentals.gr / Staff2025!`);
    console.log(`   👤 Partner: partner@prentals.gr / Partner2025!`);
    console.log(`   🚗 ${vehicles.length} οχήματα`);
    console.log(`   🏷️  3 εκπτώσεις`);
  } else {
    console.log("ℹ️  Demo Tenant υπάρχει ήδη");
  }

  console.log("\n🎉 Seeding ολοκληρώθηκε!");
  console.log("\n📋 Λογαριασμοί:");
  console.log(`   Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
  console.log(`   Company Admin: admin@prentals.gr / Admin2025!`);
  console.log(`   Staff: staff@prentals.gr / Staff2025!`);
  console.log(`   Partner: partner@prentals.gr / Partner2025!`);
}

function getDefaultTemplate(): string {
  return `<div>Βασικό template συμβολαίου. Επεξεργαστείτε από τις Ρυθμίσεις.</div>`;
}

main()
  .catch((e) => {
    console.error("❌ Σφάλμα seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
