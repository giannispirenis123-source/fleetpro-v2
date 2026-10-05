// src/lib/stagedPhotos.ts
// Φωτογραφίες σε νέο (μη αποθηκευμένο) συμβόλαιο — καθαρή λογική, χωρίς
// runtime imports (τη φορτώνουν ο client και τα tests).
//
//  · Πριν την πρώτη «Αποθήκευση» ΔΕΝ υπάρχει contractId: η φωτογραφία
//    συμπιέζεται και μένει ΜΟΝΟ στη μνήμη του browser (blob + object URL).
//    Τίποτα δεν ανεβαίνει, καμία εγγραφή στη βάση, κανένα προσωρινό αρχείο.
//  · Μετά την αποθήκευση ανεβαίνουν μία-μία με τα ΥΠΑΡΧΟΝΤΑ endpoints
//    (…/photos για ζημιές, …/licenses για διπλώματα): ίδιοι κανόνες,
//    δικαιώματα, όρια και έλεγχοι του server.
//  · Αποτυχία ενός ανεβάσματος δεν σταματά τα υπόλοιπα· η φωτογραφία μένει
//    στη λίστα με το μήνυμα της αιτίας και «Ξανά».

/** Όρια — ίδια με του server (MAX_CONTRACT_PHOTOS, MAX_LICENSE_PHOTOS). */
export const STAGE_LIMITS = { damages: 40, licensePerDriver: 4 } as const;

export type StageTarget =
  | { kind: "damage"; group: "PICKUP" | "RETURN" }
  | { kind: "license"; driverId: string };

export interface StagedPhoto<B = Blob> {
  /** Τοπικό κλειδί (όχι id του Storage). */
  key: string;
  target: StageTarget;
  /** Η συμπιεσμένη εικόνα — μόνο στη μνήμη. */
  blob: B;
  /** object URL για τη μικρογραφία. */
  previewUrl: string;
  /** ISO — από το lastModified του αρχείου. */
  takenAt: string;
  note: string;
  status: "staged" | "uploading" | "error";
  /** Το μήνυμα της αιτίας σε αποτυχία. */
  message: string;
}

export const sameTarget = (a: StageTarget, b: StageTarget) =>
  a.kind === b.kind &&
  (a.kind === "damage"
    ? a.group === (b as { group: string }).group
    : a.driverId === (b as { driverId: string }).driverId);

export const stagedFor = <B>(list: StagedPhoto<B>[], target: StageTarget) =>
  list.filter((p) => sameTarget(p.target, target));

/**
 * Πόσες ακόμα χωράνε στον στόχο, μετρώντας τις ήδη ανεβασμένες ΚΑΙ τις
 * staged. Ζημιές: όριο ανά συμβόλαιο (και οι δύο ομάδες μαζί). Δίπλωμα:
 * ανά οδηγό.
 */
export function roomFor<B>(
  target: StageTarget,
  staged: StagedPhoto<B>[],
  uploaded: { damages: number; licensesOf: (driverId: string) => number }
): number {
  if (target.kind === "damage") {
    const n = staged.filter((p) => p.target.kind === "damage").length;
    return Math.max(0, STAGE_LIMITS.damages - uploaded.damages - n);
  }
  const n = stagedFor(staged, target).length;
  return Math.max(0, STAGE_LIMITS.licensePerDriver - uploaded.licensesOf(target.driverId) - n);
}

/** Οδηγός που αφαιρέθηκε πριν την αποθήκευση → φεύγουν και οι φωτογραφίες του. */
export const pruneForDrivers = <B>(list: StagedPhoto<B>[], driverIds: string[]) => {
  const keep = new Set(driverIds);
  return list.filter((p) => p.target.kind !== "license" || keep.has(p.target.driverId));
};

/** Το αίτημα ανεβάσματος: endpoint + πεδία της φόρμας (εκτός από το αρχείο). */
export function uploadRequest<B>(
  contractId: string,
  p: StagedPhoto<B>
): { url: string; fields: Record<string, string> } {
  const base = `/api/contracts/${encodeURIComponent(contractId)}`;
  if (p.target.kind === "license") {
    return {
      url: `${base}/licenses`,
      fields: { driverId: p.target.driverId, takenAt: p.takenAt },
    };
  }
  return {
    url: `${base}/photos`,
    fields: { group: p.target.group, takenAt: p.takenAt, ...(p.note.trim() ? { note: p.note.trim() } : {}) },
  };
}

export type UploadOutcome<R> = { ok: true; result: R } | { ok: false; message: string };

/**
 * Ανεβάζει με τη σειρά, ένα-ένα. Μια αποτυχία ΔΕΝ σταματά τις επόμενες.
 * `onProgress(done, total)` μετά από κάθε προσπάθεια. Επιστρέφει τι ανέβηκε
 * και τι απέτυχε (με το μήνυμα της αιτίας).
 */
export async function uploadAll<B, R>(
  items: StagedPhoto<B>[],
  upload: (p: StagedPhoto<B>) => Promise<UploadOutcome<R>>,
  onProgress?: (done: number, total: number) => void
): Promise<{ uploaded: { key: string; result: R }[]; failed: { key: string; message: string }[] }> {
  const uploaded: { key: string; result: R }[] = [];
  const failed: { key: string; message: string }[] = [];
  let done = 0;
  for (const p of items) {
    let outcome: UploadOutcome<R>;
    try {
      outcome = await upload(p);
    } catch {
      outcome = { ok: false, message: "" };
    }
    if (outcome.ok) uploaded.push({ key: p.key, result: outcome.result });
    else failed.push({ key: p.key, message: outcome.message });
    done++;
    onProgress?.(done, items.length);
  }
  return { uploaded, failed };
}
