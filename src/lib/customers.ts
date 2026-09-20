// src/lib/customers.ts
// Κοινό σημείο για τον τύπο του πελάτη — το χρησιμοποιούν και τα API routes
// και η σελίδα, ώστε το σχήμα των δεδομένων να μην αποκλίνει.
//
// Ο Customer είναι η μόνιμη «καρτέλα» του ατόμου: από εδώ θα τραβούν αργότερα
// οι Κρατήσεις (customerId) και τα Συμβόλαια τα προσωπικά στοιχεία.

import type { Customer } from "@prisma/client";

/** Ετικέτες που δίνουν χρώμα στην κάρτα· οτιδήποτε άλλο εμφανίζεται ουδέτερο. */
export const TAG_CLASS: Record<string, string> = {
  VIP: "ok",
  Corporate: "info",
  Problematic: "warn",
};

export interface CustomerDTO {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  idNumber: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  licenseCountry: string | null;
  dateOfBirth: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  nationality: string | null;
  notes: string | null;
  tags: string[];
  isBlacklisted: boolean;
  totalRevenue: number;
  bookingsCount: number;
}

const toDateInput = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/** Το `bookingsCount` έρχεται από _count όταν υπάρχει· αλλιώς μηδέν. */
export function toCustomerDTO(
  c: Customer & { _count?: { bookings: number } }
): CustomerDTO {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    phone2: c.phone2,
    idNumber: c.idNumber,
    licenseNumber: c.licenseNumber,
    licenseExpiry: toDateInput(c.licenseExpiry),
    licenseCountry: c.licenseCountry,
    dateOfBirth: toDateInput(c.dateOfBirth),
    address: c.address,
    city: c.city,
    country: c.country,
    nationality: c.nationality,
    notes: c.notes,
    tags: c.tags,
    isBlacklisted: c.isBlacklisted,
    totalRevenue: Number(c.totalRevenue),
    bookingsCount: c._count?.bookings ?? 0,
  };
}
