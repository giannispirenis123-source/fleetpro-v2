// src/lib/authz.ts
// Ο έλεγχος δικαιωμάτων ΣΤΟΝ SERVER — η πηγή αλήθειας.
//
// Τα δικαιώματα διαβάζονται από τη ΒΑΣΗ σε κάθε αίτημα, όχι από το JWT.
// Το token ζει 7 ημέρες· αν τα δικαιώματα ταξίδευαν μέσα του, μια αφαίρεση
// δικαιώματος δεν θα ίσχυε μέχρι να λήξει. Έτσι ισχύει αμέσως.
//
// Στο ίδιο ερώτημα ελέγχουμε και το isActive: απενεργοποιημένος χρήστης με
// ζωντανό cookie δεν πρέπει να περνά.

import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import { getSession, type JWTPayload } from "./auth";
import { forbidden, unauthorized, serverError, withAuth } from "./api";
import { can, type PermissionKey } from "./permissions";
import { loadViewer, type Viewer } from "./viewer";

export type { Viewer };

export { loadViewer } from "./viewer";

export const viewerCan = (viewer: Viewer, key: PermissionKey): boolean =>
  can(viewer.role, viewer.permissions, key);

/* ─────────────────────────────────────────────
   API routes
   ───────────────────────────────────────────── */

/**
 * Αντικαθιστά το withAuth(handler, roles): αντί για «ποιος ρόλος είσαι»,
 * ρωτά «αυτό το δικαίωμα το έχεις;». Ο διαχειριστής περνά πάντα.
 *
 * Η υπογραφή του handler μένει ίδια με του withAuth, ώστε οι υπάρχουσες
 * διαδρομές να αλλάζουν μόνο στη γραμμή του φύλακα.
 *
 * Πολλά κλειδιά σημαίνουν ΟΛΑ — π.χ. μια ενέργεια που χρειάζεται και
 * προβολή και επεξεργασία.
 */
export function withPermission(
  handler: (
    req: NextRequest,
    session: JWTPayload,
    params?: Record<string, string>,
    /** Ο χρήστης όπως είναι στη βάση — τον έχει ήδη διαβάσει ο φύλακας. */
    viewer?: Viewer
  ) => Promise<NextResponse>,
  keys: PermissionKey | PermissionKey[]
) {
  const required = Array.isArray(keys) ? keys : [keys];

  // Ο χρήστης διαβάζεται ΜΙΑ φορά (στο withAuth) και περνά εδώ.
  return withAuth(async (req, session, params, viewer) => {
    if (!viewer) return unauthorized();

    // Χρήστης πλατφόρμας δεν έχει θέση στα δεδομένα εταιρίας.
    if (viewer.role !== "SUPER_ADMIN" && !viewer.tenantId) {
      return forbidden();
    }

    if (required.some((k) => !viewerCan(viewer, k))) {
      return forbidden("Δεν έχετε δικαίωμα για αυτή την ενέργεια");
    }

    return handler(req, session, params, viewer);
  });
}

/**
 * Έλεγχος ενός επιπλέον δικαιώματος ΜΕΣΑ σε handler — για ενέργειες που
 * ξεκλειδώνουν κάτι παραπάνω, όπως η παράκαμψη σύγκρουσης.
 */
export async function sessionCan(
  session: JWTPayload,
  key: PermissionKey
): Promise<boolean> {
  const viewer = await loadViewer(session);
  return viewer ? viewerCan(viewer, key) : false;
}

/* ─────────────────────────────────────────────
   Σελίδες (server components)
   ───────────────────────────────────────────── */

export interface PageGuard {
  session: JWTPayload;
  viewer: Viewer;
}

/**
 * Για σελίδες: επιστρέφει null όταν ο χρήστης δεν επιτρέπεται, ώστε η
 * σελίδα να κάνει redirect. Δεν κάνει το redirect μόνη της για να μη
 * δεσμεύει τον προορισμό.
 */
export async function pageViewer(): Promise<Viewer | null> {
  const session = await getSession();
  if (!session) return null;
  return loadViewer(session);
}

export { serverError };

/**
 * Φύλακας σελίδας: επιστρέφει τον χρήστη όταν έχει το δικαίωμα, αλλιώς
 * null ώστε η σελίδα να κάνει redirect. Το ίδιο κλειδί με το API, οπότε
 * δεν μπορεί να ξεφύγει σελίδα που δείχνει κάτι το οποίο το API αρνείται.
 */
export interface GuardedPage {
  /** Εγγυημένα χρήστης εταιρίας: το tenantId δεν είναι ποτέ null εδώ. */
  session: JWTPayload & { tenantId: string };
  viewer: Viewer;
}

export async function pageGuard(
  key: PermissionKey
): Promise<GuardedPage | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.role === "SUPER_ADMIN" || !session.tenantId) return null;

  const viewer = await loadViewer(session);
  if (!viewer || !viewerCan(viewer, key)) return null;

  return { session: session as JWTPayload & { tenantId: string }, viewer };
}

/* ─────────────────────────────────────────────
   Στεγανότητα συνεργάτη
   ───────────────────────────────────────────── */

/**
 * Το φίλτρο κρατήσεων για τον συγκεκριμένο χρήστη.
 *
 * Ο συνεργάτης βλέπει ΜΟΝΟ τις κρατήσεις που έφερε ο ίδιος. Το φίλτρο
 * μπαίνει στο ερώτημα της βάσης, όχι στην εμφάνιση: μια κράτηση άλλου
 * δεν φτάνει ποτέ μέχρι το πρόγραμμα περιήγησης, ούτε καν για να κρυφτεί.
 */
export function bookingScope(viewer: Viewer): {
  tenantId: string;
  partnerId?: string;
} {
  const base = { tenantId: viewer.tenantId! };
  return viewer.role === "PARTNER"
    ? { ...base, partnerId: viewer.userId }
    : base;
}

export const isPartner = (viewer: Viewer): boolean => viewer.role === "PARTNER";
