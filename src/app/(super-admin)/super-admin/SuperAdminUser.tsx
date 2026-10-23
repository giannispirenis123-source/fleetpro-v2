"use client";

// src/app/(super-admin)/super-admin/SuperAdminUser.tsx
// Ο συνδεδεμένος Super Admin (όνομα/email από τη βάση, μέσω του layout) για το
// μενού λογαριασμού της σελίδας — αντί για τα σταθερά «Super Admin» /
// «admin@fleetpro.gr» που υπήρχαν πριν.

import { createContext, useContext } from "react";

export interface SuperAdminUser {
  name: string;
  email: string;
}

const Ctx = createContext<SuperAdminUser>({ name: "", email: "" });

export function SuperAdminUserProvider({ user, children }: { user: SuperAdminUser; children: React.ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export const useSuperAdminUser = () => useContext(Ctx);
