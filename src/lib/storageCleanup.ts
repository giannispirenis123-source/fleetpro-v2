// src/lib/storageCleanup.ts
// Διαγραφή ΟΛΩΝ των αρχείων μιας εταιρίας από το Supabase Storage — ΚΑΘΑΡΗ
// λογική (η πρόσβαση στο Storage δίνεται από τον καλούντα → tests χωρίς δίκτυο).
//
// Όλα τα αρχεία μιας εταιρίας ζουν κάτω από τον φάκελο "<tenantId>/"
// (συμβόλαια, ζημιές, διπλώματα, λογότυπο — βλ. HANDOFF §3.1). Η στεγανότητα
// βγαίνει ΑΠΟ ΤΗΝ ΚΑΤΑΣΚΕΥΗ: κάθε διαδρομή που σβήνεται χτίζεται ως
// "<tenantId>/…/<όνομα>" από τον φάκελο που ζητήθηκε· ποτέ από ό,τι επιστρέφει
// το Storage ως πλήρη διαδρομή. Όνομα με «/» ή «..» αγνοείται.

export interface StorageEntry {
  name: string;
  /** null = φάκελος (έτσι τον επιστρέφει το Supabase Storage). */
  id: string | null;
}

export interface TenantStorageDeps {
  /** Τα περιεχόμενα ΕΝΟΣ φακέλου (όχι αναδρομικά), σε σελίδες. */
  list(folder: string, offset: number, limit: number): Promise<StorageEntry[]>;
  /** Σβήνει τις διαδρομές· true = επιτυχία. */
  remove(paths: string[]): Promise<boolean>;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PAGE = 100;
const MAX_DEPTH = 8;
const MAX_FILES = 50_000;

const safeName = (n: unknown): n is string =>
  typeof n === "string" && n.length > 0 && n.length <= 300 && !n.includes("/") && !n.includes("\\") && n !== "." && n !== "..";

/** Όλες οι διαδρομές αρχείων κάτω από "<tenantId>/". Άκυρο id → κενή λίστα. */
export async function collectTenantPaths(tenantId: string, list: TenantStorageDeps["list"]): Promise<string[]> {
  if (!ID_RE.test(tenantId)) return [];
  const files: string[] = [];
  const queue: { folder: string; depth: number }[] = [{ folder: tenantId, depth: 0 }];
  while (queue.length > 0 && files.length < MAX_FILES) {
    const { folder, depth } = queue.shift()!;
    for (let offset = 0; files.length < MAX_FILES; offset += PAGE) {
      const page = await list(folder, offset, PAGE);
      for (const e of page) {
        if (!safeName(e?.name)) continue;
        const path = `${folder}/${e.name}`;
        if (e.id === null) {
          if (depth + 1 < MAX_DEPTH) queue.push({ folder: path, depth: depth + 1 });
        } else {
          files.push(path);
        }
      }
      if (page.length < PAGE) break;
    }
  }
  // Δεύτερη δικλείδα: ΜΟΝΟ διαδρομές της συγκεκριμένης εταιρίας.
  return files.filter((p) => p.startsWith(`${tenantId}/`));
}

/**
 * Σβήνει όλα τα αρχεία της εταιρίας. Επιστρέφει πόσα σβήστηκαν και πόσα
 * απέτυχαν (best effort — ο καλών γράφει μόνο τα πλήθη στα logs).
 */
export async function removeTenantFiles(tenantId: string, deps: TenantStorageDeps): Promise<{ removed: number; failed: number }> {
  const paths = await collectTenantPaths(tenantId, deps.list);
  let removed = 0;
  let failed = 0;
  for (let i = 0; i < paths.length; i += PAGE) {
    const chunk = paths.slice(i, i + PAGE);
    if (await deps.remove(chunk).catch(() => false)) removed += chunk.length;
    else failed += chunk.length;
  }
  return { removed, failed };
}
