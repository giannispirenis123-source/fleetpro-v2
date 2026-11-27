// src/lib/public/requestPrivacy.ts
// Λειτουργία REQUEST: ο πελάτης ζητά ΚΑΤΗΓΟΡΙΑ (ομάδα), όχι όχημα. Το όχημα
// που ανατέθηκε αυτόματα στο PENDING είναι προσωρινή δέσμευση και ΔΕΝ πρέπει
// να φαίνεται ποτέ στον πελάτη (σελίδα επιβεβαίωσης, email). — ΚΑΘΑΡΗ λογική.
//
// Στο BOOKING, ή σε κράτηση χωρίς ομάδα (κάρτα "v.<id>", όπου ο πελάτης
// διάλεξε το ίδιο το όχημα), η συμπεριφορά μένει ΟΠΩΣ ΗΤΑΝ.

import { readVehiclePhotos } from "../vehiclePhotos";
import { readLocalized, textFor } from "./text";

/** Κρύβουμε το ανατεθειμένο όχημα; ΜΟΝΟ σε REQUEST και ΜΟΝΟ όταν υπάρχει ομάδα. */
export const hidesAssignedVehicle = (rentalMode: string | null | undefined, hasGroup: boolean): boolean =>
  rentalMode === "REQUEST" && hasGroup;

/**
 * Όνομα κατηγορίας χωρίς διαρροή: το όνομα της ομάδας, αλλιώς ο κωδικός της
 * (όπως στην κάρτα του site) — ποτέ μάρκα/μοντέλο του ανατεθειμένου οχήματος.
 */
export function requestGroupName(group: { name: unknown; code: string }, lang: string): string {
  return textFor(readLocalized(group.name), lang) || group.code;
}

/**
 * Φωτογραφία κατηγορίας χωρίς διαρροή — ΙΔΙΟΣ κανόνας με την κάρτα του site
 * (catalog.ts): η πρώτη της ομάδας, αλλιώς η πρώτη από τα οχήματα της ομάδας
 * με σταθερή σειρά. ΠΟΤΕ η φωτογραφία του οχήματος της κράτησης ειδικά.
 */
export function requestGroupPhoto(groupPhotos: unknown, memberPhotos: unknown[]): string | null {
  const own = readVehiclePhotos(groupPhotos)[0]?.url;
  if (own) return own;
  for (const p of memberPhotos) {
    const url = readVehiclePhotos(p)[0]?.url;
    if (url) return url;
  }
  return null;
}
