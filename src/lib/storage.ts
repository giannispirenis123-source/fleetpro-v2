// src/lib/storage.ts
// Supabase Storage — ΜΟΝΟ server-side.
//
// Ιδιωτικό bucket: τίποτα δεν είναι δημόσιο. Ο server ανεβάζει, σβήνει και
// βγάζει προσωρινά (signed) URLs σε κάθε φόρτωση σελίδας. Το κλειδί
// (service role / secret key) ζει μόνο σε env var χωρίς NEXT_PUBLIC_ και
// δεν εμφανίζεται ποτέ σε απάντηση, μήνυμα σφάλματος ή log.
//
// Μιλάμε απευθείας στο REST API του Storage με fetch: καμία εξάρτηση.
//
// Server-only.

/** Το όνομα του bucket στο Supabase (Storage → New bucket, Private). */
export const STORAGE_BUCKET = "fleetpro-files";

/** Πόσο ισχύει ένα προσωρινό URL φωτογραφίας. */
export const SIGNED_URL_SECONDS = 60 * 60;

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

/** Υπάρχουν τα env vars; Αλλιώς οι φωτογραφίες απενεργοποιούνται καθαρά. */
export const storageConfigured = (): boolean => config() !== null;

function need() {
  const c = config();
  if (!c) throw new StorageError("Η αποθήκευση αρχείων δεν έχει ρυθμιστεί");
  return c;
}

/**
 * Παλιό κλειδί service_role = JWT → και Authorization. Νέο «secret key»
 * (sb_secret_…) → μόνο apikey: ο gateway το αναγνωρίζει μόνος του.
 */
function headers(key: string): Record<string, string> {
  const h: Record<string, string> = { apikey: key };
  if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
  return h;
}

/** Κάθε τμήμα της διαδρομής κωδικοποιημένο — οι κάθετοι μένουν. */
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Μόνο ο κωδικός HTTP στο log — ποτέ headers ή σώμα αιτήματος. */
function fail(action: string, status: number): never {
  console.error(`Storage ${action}: HTTP ${status}`);
  throw new StorageError("Η αποθήκευση αρχείου απέτυχε");
}

export async function uploadObject(path: string, body: Uint8Array, contentType: string) {
  const { url, key } = need();
  let res: Response;
  try {
    res = await fetch(`${url}/storage/v1/object/${STORAGE_BUCKET}/${encodePath(path)}`, {
      method: "POST",
      headers: {
        ...headers(key),
        "Content-Type": contentType,
        "x-upsert": "false",
        "cache-control": "3600",
      },
      body: Buffer.from(body),
      cache: "no-store",
    });
  } catch {
    console.error("Storage upload: σφάλμα δικτύου");
    throw new StorageError("Η αποθήκευση αρχείου απέτυχε");
  }
  if (!res.ok) fail("upload", res.status);
}

/** Σβήνει αρχεία. Δεν πετά σφάλμα: ένα ορφανό αρχείο δεν σπάει τη ροή. */
export async function removeObjects(paths: string[]): Promise<void> {
  const list = paths.filter((p) => p && !/^https?:/i.test(p));
  const c = config();
  if (!c || list.length === 0) return;
  try {
    const res = await fetch(`${c.url}/storage/v1/object/${STORAGE_BUCKET}`, {
      method: "DELETE",
      headers: { ...headers(c.key), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: list }),
      cache: "no-store",
    });
    if (!res.ok) console.error(`Storage remove: HTTP ${res.status}`);
  } catch {
    console.error("Storage remove: σφάλμα δικτύου");
  }
}

/**
 * Προσωρινά URLs για πολλές διαδρομές με ένα αίτημα. Ό,τι αποτύχει (ή αν
 * λείπουν τα env vars) δεν έχει URL — η σελίδα δείχνει «μη διαθέσιμη».
 * Παλιές τιμές που είναι ήδη URL επιστρέφονται ως έχουν.
 */
export async function signUrls(
  paths: string[],
  seconds = SIGNED_URL_SECONDS
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo: string[] = [];
  for (const p of paths) {
    if (/^https?:/i.test(p)) out.set(p, p);
    else if (p) todo.push(p);
  }
  const c = config();
  if (!c || todo.length === 0) return out;

  try {
    const res = await fetch(`${c.url}/storage/v1/object/sign/${STORAGE_BUCKET}`, {
      method: "POST",
      headers: { ...headers(c.key), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: seconds, paths: Array.from(new Set(todo)) }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`Storage sign: HTTP ${res.status}`);
      return out;
    }
    const rows = (await res.json()) as { path?: string; signedURL?: string | null; error?: unknown }[];
    for (const r of rows) {
      if (r.path && r.signedURL) out.set(r.path, `${c.url}/storage/v1${r.signedURL}`);
    }
  } catch {
    console.error("Storage sign: σφάλμα δικτύου");
  }
  return out;
}
