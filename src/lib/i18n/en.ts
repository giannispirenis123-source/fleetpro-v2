// src/lib/i18n/en.ts
// English dictionary. Typed as Dictionary, so a missing or misspelled key
// fails the typecheck instead of silently falling back at runtime.

import type { Dictionary } from "./el";

export const en: Dictionary = {
  common: {
    appName: "FleetPro",
    language: "Language",
    greek: "Greek",
    english: "English",
    logout: "Sign out",
    menu: "Menu",
    close: "Close",
    comingSoon: "soon",
    myCompany: "My company",
  },

  auth: {
    heroTitleLine1: "Fleet management",
    heroTitleLine2: "without limits",
    heroSubtitle:
      "The platform every car rental company needs to run efficiently and professionally.",
    feature1: "Multi-tenant architecture",
    feature2: "Digital contracts & signatures",
    feature3: "Discounts & offers engine",
    feature4: "Real-time reports & statistics",
    welcome: "Welcome back",
    signInPrompt: "Sign in to your account",
    email: "Email",
    emailPlaceholder: "email@company.com",
    password: "Password",
    signIn: "Sign in",
    noAccount: "Don't have an account?",
    contactUs: "Get in touch",
    demoAccounts: "Demo accounts",
    errorMissingFields: "Please enter your email and password",
    errorGeneric: "Sign-in failed. Please try again.",
    errorDefault: "Sign-in failed",
    showPassword: "Show password",
    hidePassword: "Hide password",
  },

  sidebar: {
    overview: "Overview",
    bookings: "Bookings",
    calendar: "Calendar",
    fleet: "Fleet",
    customers: "Customers",
    contracts: "Contracts",
    invoices: "Invoices",
    service: "Service & Damages",
    reports: "Reports",
    finance: "Finance",
    users: "Users",
    settings: "Settings",
    roleCompanyAdmin: "Administrator",
    roleStaff: "Staff",
    rolePartner: "Partner",
  },

  dashboard: {
    greeting: "Good morning",
    subtitle: "Here's a quick snapshot of your business today.",
    availableVehicles: "Available vehicles",
    rentedVehicles: "Rented out",
    inMaintenance: "In maintenance",
    monthRevenue: "Revenue this month",
    fleetOccupancy: "Fleet occupancy",
    activeBookings: "Active bookings",
    alerts: "Alerts",
    alertServiceOne: "vehicle needs service (≤30 days)",
    alertServiceMany: "vehicles need service (≤30 days)",
    alertInsurance: "insurance expiring soon (≤60 days)",
    alertMot: "MOT expiring soon (≤60 days)",
    alertUnsignedContracts: "unsigned contracts",
    allClear: "All clear — nothing pending right now.",
    recentBookings: "Recent bookings",
    noBookings: "No bookings yet.",
    pendingItems: "Pending items",
    pendingDamages: "Damages pending",
    unpaidInvoices: "Unpaid invoices",
    totalFleet: "Total fleet",
  },

  status: {
    PENDING: "Pending",
    CONFIRMED: "Confirmed",
    ACTIVE: "Active",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  },
};
