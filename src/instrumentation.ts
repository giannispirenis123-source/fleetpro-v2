// src/instrumentation.ts
// Τρέχει ΜΙΑ φορά στην εκκίνηση του server (Next.js instrumentation).
//
// Ελέγχει τις ρυθμίσεις του Supabase Storage και γράφει ΣΑΦΕΣ μήνυμα στα
// logs του Vercel αν κάτι λείπει ή είναι λάθος (π.χ. SUPABASE_URL που δεν
// ξεκινά με https:// ή δεν τελειώνει σε .supabase.co). Μόνο ονόματα
// μεταβλητών, ποτέ τιμές. Δεν σταματά την εφαρμογή: χωρίς Storage όλα τα
// άλλα δουλεύουν, και το ανέβασμα φωτογραφιών δείχνει το ίδιο μήνυμα.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Κατά το build δεν υπάρχουν πάντα τα env vars της παραγωγής.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { storageStartupProblem, STORAGE_BUCKET } = await import("./lib/storage");
  const problem = storageStartupProblem();
  if (problem) {
    console.error(
      `[FleetPro] Supabase Storage ΔΕΝ είναι έτοιμο (${problem.code}): ${problem.message} ` +
        "Οι φωτογραφίες ζημιών δεν θα ανεβαίνουν μέχρι να διορθωθεί."
    );
  } else {
    console.log(`[FleetPro] Supabase Storage: ρυθμίσεις εντάξει (bucket ${STORAGE_BUCKET}).`);
  }
}
