// src/lib/invoiceIssue.ts
// Έκδοση τιμολογίου από κράτηση — ΕΝΑ σημείο, για την αυτόματη έκδοση
// (κράτηση → COMPLETED) και για το χειροκίνητο κουμπί.
//
// Δύο πράγματα που δεν επιτρέπεται να πάνε στραβά:
//  1. Μία κράτηση → ΕΝΑ τιμολόγιο. Το εγγυάται το bookingId @unique στη
//     βάση· ο έλεγχος πριν είναι απλώς για καθαρό μήνυμα.
//  2. Αρίθμηση χωρίς κενά και χωρίς διπλά. Το εγγυάται το
//     @@unique([tenantId, invoiceNumber]): αν δύο εκδόσεις πέσουν μαζί, η
//     μία σκάει και ξαναδοκιμάζει με τον επόμενο αριθμό.

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { DUE_DAYS, splitVatInclusive } from "./invoices";

/** Πόσες φορές ξαναδοκιμάζουμε αν «κλαπεί» ο αριθμός από ταυτόχρονη έκδοση. */
const MAX_ATTEMPTS = 5;

export type IssueOutcome =
  | { ok: true; invoiceId: string; invoiceNumber: string; created: true }
  | { ok: true; invoiceId: string; invoiceNumber: string; created: false }
  | { ok: false; message: string };

/** INV-001, INV-002… ανά εταιρία. */
function formatNumber(seq: number): string {
  return `INV-${String(seq).padStart(3, "0")}`;
}

/**
 * Ακριβώς η δική μας μορφή. Παλιότερα τιμολόγια μπορεί να έχουν άλλη
 * (π.χ. INV-2025-101) — αυτά τα αγνοούμε αντί να τα παρερμηνεύσουμε ως
 * τεράστιο αύξοντα αριθμό.
 */
const NUMBER_RE = /^INV-(\d+)$/;

/**
 * Ο επόμενος ελεύθερος αριθμός, από τον μεγαλύτερο που υπάρχει.
 *
 * Το μέγιστο βγαίνει ΑΡΙΘΜΗΤΙΚΑ και όχι με ταξινόμηση κειμένου: το
 * "INV-999" είναι αλφαβητικά μεγαλύτερο από το "INV-1000", οπότε μια
 * ταξινόμηση στη βάση θα κολλούσε στο χιλιοστό τιμολόγιο.
 */
async function nextSequence(tenantId: string): Promise<number> {
  const rows = await db.invoice.findMany({
    where: { tenantId, invoiceNumber: { startsWith: "INV-" } },
    select: { invoiceNumber: true },
  });

  let max = 0;
  for (const row of rows) {
    const match = NUMBER_RE.exec(row.invoiceNumber);
    if (!match) continue;
    const value = parseInt(match[1], 10);
    if (value > max) max = value;
  }

  return max + 1;
}

/**
 * Εκδίδει τιμολόγιο για την κράτηση, αν δεν υπάρχει ήδη.
 *
 * Επιστρέφει created:false όταν υπήρχε ήδη — δεν είναι σφάλμα, είναι ο
 * φύλακας που δουλεύει. Έτσι η αυτόματη έκδοση μπορεί να καλείται ξανά
 * και ξανά χωρίς να διπλασιάζει τίποτα.
 */
export async function issueInvoiceForBooking(opts: {
  tenantId: string;
  bookingId: string;
}): Promise<IssueOutcome> {
  const booking = await db.booking.findFirst({
    where: { id: opts.bookingId, tenantId: opts.tenantId },
    select: {
      id: true,
      bookingNumber: true,
      customerId: true,
      total: true,
      status: true,
    },
  });
  if (!booking) return { ok: false, message: "Η κράτηση δεν βρέθηκε" };

  if (booking.status === "CANCELLED") {
    return { ok: false, message: "Ακυρωμένη κράτηση δεν τιμολογείται" };
  }

  // Φύλακας: μία κράτηση, ένα τιμολόγιο.
  const existing = await db.invoice.findUnique({
    where: { bookingId: booking.id },
    select: { id: true, invoiceNumber: true },
  });
  if (existing) {
    return {
      ok: true,
      invoiceId: existing.id,
      invoiceNumber: existing.invoiceNumber,
      created: false,
    };
  }

  const tenant = await db.tenant.findUnique({
    where: { id: opts.tenantId },
    select: { vatRate: true },
  });
  if (!tenant) return { ok: false, message: "Η εταιρία δεν βρέθηκε" };

  // Το ποσό της κράτησης ΠΕΡΙΕΧΕΙ ΦΠΑ — το σπάμε ανάποδα. Το ποσοστό
  // αποθηκεύεται στο τιμολόγιο, ώστε μελλοντική αλλαγή ΦΠΑ να μην
  // αλλοιώνει παλιά τιμολόγια.
  const split = splitVatInclusive(Number(booking.total), Number(tenant.vatRate));

  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + DUE_DAYS * 86400000);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const invoiceNumber = formatNumber(await nextSequence(opts.tenantId));

    try {
      const invoice = await db.invoice.create({
        data: {
          tenantId: opts.tenantId,
          bookingId: booking.id,
          customerId: booking.customerId,
          invoiceNumber,
          issueDate,
          dueDate,
          subtotal: split.net,
          taxRate: split.vatRate,
          taxAmount: split.vatAmount,
          total: split.total,
          status: "UNPAID",
        },
        select: { id: true, invoiceNumber: true },
      });

      return {
        ok: true,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        created: true,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = (error.meta?.target ?? []) as string[];

        // Κάποιος πρόλαβε τον αριθμό — ξαναδοκιμάζουμε με τον επόμενο.
        if (target.includes("invoiceNumber")) continue;

        // Κάποιος πρόλαβε την ΚΡΑΤΗΣΗ — υπάρχει ήδη τιμολόγιο, το
        // επιστρέφουμε αντί να σκάσουμε.
        if (target.includes("bookingId")) {
          const other = await db.invoice.findUnique({
            where: { bookingId: booking.id },
            select: { id: true, invoiceNumber: true },
          });
          if (other) {
            return {
              ok: true,
              invoiceId: other.id,
              invoiceNumber: other.invoiceNumber,
              created: false,
            };
          }
        }
      }
      throw error;
    }
  }

  return {
    ok: false,
    message: "Δεν ήταν δυνατή η έκδοση αριθμού τιμολογίου — δοκίμασε ξανά",
  };
}
