// src/lib/storage.ts
// Supabase Storage — ΜΟΝΟ server-side.
//
// Ιδιωτικό bucket: τίποτα δεν είναι δημόσιο. Ο server ανεβάζει, σβήνει και
// βγάζει προσωρινά (signed) URLs σε κάθε φόρτωση σελίδας. Το κλειδί
// (service role / secret key) ζει μόνο σε env var χωρίς NEXT_PUBLIC_ και
// δεν εμφανίζεται ποτέ σε απάντηση, μήνυμα σφάλματος ή log.
//
// Κάθε αποτυχία γίνεται StorageError με ΣΥΓΚΕΚΡΙΜΕΝΗ αιτία (λείπει env var,
// λάθος URL, λάθος κλειδί, δεν υπάρχει bucket, απόρριψη αρχείου, δίκτυο) και
// ασφαλές μήνυμα για τον χρήστη. Στο log γράφεται το status και το μήνυμα
// της Supabase, καθαρισμένο από κλειδιά, tokens και URLs.
//
// Μιλάμε απευθείας στο REST API του Storage με fetch: καμία εξάρτηση.
//
// Server-only.

/** Το όνομα του bucket στο Supabase (Storage → New bucket, Private). */
export const STORAGE_BUCKET = "fleetpro-files";

/** Πόσο ισχύει ένα προσωρινό URL φωτογραφίας. */
export const SIGNED_URL_SECONDS = 60 * 60;

export type StorageErrorCode =
  | "CONFIG_MISSING"
  | "CONFIG_INVALID_URL"
  | "AUTH"
  | "BUCKET_NOT_FOUND"
  | "REJECTED_TYPE"
  | "REJECTED_SIZE"
  | "NETWORK"
  | "UNKNOWN";

/** Ο κωδικός HTTP που επιστρέφει ο ΔΙΚΟΣ μας server για κάθε αιτία. */
const HTTP_FOR: Record<StorageErrorCode, number> = {
  CONFIG_MISSING: 503,
  CONFIG_INVALID_URL: 503,
  AUTH: 502,
  BUCKET_NOT_FOUND: 502,
  REJECTED_TYPE: 415,
  REJECTED_SIZE: 413,
  NETWORK: 502,
  UNKNOWN: 502,
};

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly httpStatus: number;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.httpStatus = HTTP_FOR[code];
  }
}

/* ─────────────────────────────────────────────
   Ρυθμίσεις
   ───────────────────────────────────────────── */

const ENV_URL = "SUPABASE_URL";
const ENV_KEY = "SUPABASE_SERVICE_ROLE_KEY";

/**
 * Τι λείπει ή τι είναι λάθος στις ρυθμίσεις — με ΟΝΟΜΑΤΑ μεταβλητών,
 * ποτέ τιμές. null = όλα εντάξει.
 */
export function storageConfigProblem(): StorageError | null {
  const url = process.env[ENV_URL]?.trim() ?? "";
  const key = process.env[ENV_KEY]?.trim() ?? "";

  const missing = [!url && ENV_URL, !key && ENV_KEY].filter(Boolean) as string[];
  if (missing.length > 0) {
    return new StorageError(
      "CONFIG_MISSING",
      `Λείπει ${missing.length > 1 ? "οι μεταβλητές" : "η μεταβλητή"} ${missing.join(", ")} ` +
        "στις ρυθμίσεις του server (Vercel → Settings → Environment Variables)."
    );
  }

  if (!validSupabaseUrl(url)) {
    return new StorageError(
      "CONFIG_INVALID_URL",
      `Το ${ENV_URL} δεν έχει τη σωστή μορφή: πρέπει να ξεκινά με https:// και να ` +
        "τελειώνει σε .supabase.co (Supabase → Project Settings → API → Project URL)."
    );
  }
  return null;
}

/** https://<ref>.supabase.co (χωρίς διαδρομή — μια κάθετος στο τέλος επιτρέπεται). */
function validSupabaseUrl(raw: string): boolean {
  const url = raw.replace(/\/+$/, "");
  if (!/^https:\/\//i.test(url) || !/\.supabase\.co$/i.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".supabase.co") && u.pathname === "/";
  } catch {
    return false;
  }
}

/**
 * Τοπικές δοκιμές μόνο: STORAGE_ALLOW_LOCAL_URL=1 επιτρέπει http://localhost
 * (mock Storage). Στην παραγωγή δεν ορίζεται ποτέ.
 */
function localOverride(raw: string): boolean {
  return (
    process.env.NODE_ENV !== "production" || process.env.STORAGE_ALLOW_LOCAL_URL === "1"
  ) && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(raw);
}

function config(): { url: string; key: string } {
  const url = process.env[ENV_URL]?.trim() ?? "";
  const problem = storageConfigProblem();
  // Μόνο η μορφή του URL παρακάμπτεται τοπικά — ποτέ κάποια μεταβλητή που λείπει.
  if (problem && !(problem.code === "CONFIG_INVALID_URL" && localOverride(url))) throw problem;
  return { url: url.replace(/\/+$/, ""), key: process.env[ENV_KEY]!.trim() };
}

/** Υπάρχουν σωστές ρυθμίσεις; Αλλιώς οι φωτογραφίες απενεργοποιούνται καθαρά. */
export function storageConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

/** Για τον έλεγχο εκκίνησης (instrumentation): ίδιο κριτήριο με το config(). */
export function storageStartupProblem(): StorageError | null {
  try {
    config();
    return null;
  } catch (e) {
    return e instanceof StorageError ? e : null;
  }
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

/* ─────────────────────────────────────────────
   Σφάλματα: αιτία, μήνυμα χρήστη, ασφαλές log
   ───────────────────────────────────────────── */

/** Βγάζει από ένα κείμενο ό,τι θα μπορούσε να είναι μυστικό. */
export function scrub(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/eyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, "[jwt]")
    .replace(/sb_(secret|publishable)_[\w-]+/gi, "[key]")
    .replace(/(token|apikey|key|signature)=[^\s&"]+/gi, "$1=[hidden]")
    .replace(/Bearer\s+\S+/gi, "Bearer [hidden]")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

/**
 * Η Supabase συχνά απαντά HTTP 400 με { statusCode: "404", error, message }
 * στο σώμα (π.χ. «Bucket not found», «invalid signature»). Κοιτάμε πρώτα
 * το statusCode του σώματος, μετά το HTTP, μετά το κείμενο.
 */
function classify(httpStatus: number, body: { statusCode?: unknown; error?: unknown; message?: unknown }) {
  const inner = Number(body.statusCode);
  const status = Number.isFinite(inner) && inner > 0 ? inner : httpStatus;
  const text = `${String(body.error ?? "")} ${String(body.message ?? "")}`.toLowerCase();

  if (/bucket not found/.test(text)) return "BUCKET_NOT_FOUND" as const;
  if (status === 401 || status === 403 || /jwt|signature|unauthori[sz]ed|invalid.*(key|token)|apikey/.test(text)) {
    return "AUTH" as const;
  }
  if (status === 404) return "BUCKET_NOT_FOUND" as const;
  if (status === 413 || /too large|exceeded the maximum|payload/.test(text)) return "REJECTED_SIZE" as const;
  if (status === 415 || /mime|content.?type|invalid_mime/.test(text)) return "REJECTED_TYPE" as const;
  if (status === 400 || status === 422) return "REJECTED_TYPE" as const;
  return "UNKNOWN" as const;
}

const USER_MESSAGE: Record<Exclude<StorageErrorCode, "CONFIG_MISSING" | "CONFIG_INVALID_URL">, string> = {
  AUTH:
    "Το Supabase Storage αρνήθηκε την πρόσβαση: λάθος κλειδί στο SUPABASE_SERVICE_ROLE_KEY " +
    "(χρειάζεται το service_role ή ένα Secret key, όχι το anon/publishable).",
  BUCKET_NOT_FOUND: `Δεν βρέθηκε το bucket «${STORAGE_BUCKET}» στο Supabase Storage (ή το SUPABASE_URL δείχνει σε άλλο project).`,
  REJECTED_TYPE:
    "Το Storage απέρριψε τον τύπο του αρχείου. Έλεγξε τα Allowed MIME types του bucket (image/jpeg, image/png, image/webp).",
  REJECTED_SIZE:
    "Το Storage απέρριψε το αρχείο λόγω μεγέθους. Έλεγξε το όριο μεγέθους του bucket (5 MB).",
  NETWORK: "Δεν υπάρχει σύνδεση με το Supabase Storage. Δοκίμασε ξανά σε λίγο.",
  UNKNOWN: "Το Supabase Storage απέρριψε το αίτημα. Δοκίμασε ξανά.",
};

/** Διαβάζει το σώμα σφάλματος, γράφει ασφαλές log, επιστρέφει StorageError. */
async function responseError(action: string, res: Response): Promise<StorageError> {
  let body: { statusCode?: unknown; error?: unknown; message?: unknown } = {};
  let raw = "";
  try {
    raw = await res.text();
    body = JSON.parse(raw);
  } catch {
    /* όχι JSON */
  }
  const code = classify(res.status, body);
  const detail = scrub(
    [body.statusCode && `statusCode ${String(body.statusCode)}`, body.error, body.message]
      .filter(Boolean)
      .map(String)
      .join(" · ") || raw
  );
  console.error(`Storage ${action}: HTTP ${res.status} → ${code}${detail ? ` — ${detail}` : ""}`);
  return new StorageError(code, USER_MESSAGE[code]);
}

/** Σφάλμα δικτύου: μόνο ο κωδικός του (ENOTFOUND, ECONNREFUSED…), ποτέ URL. */
function networkError(action: string, e: unknown): StorageError {
  const cause = (e as { cause?: { code?: unknown } })?.cause;
  const sys = cause && typeof cause.code === "string" ? cause.code : (e as Error)?.name ?? "error";
  console.error(`Storage ${action}: σφάλμα δικτύου (${scrub(String(sys))})`);
  return new StorageError("NETWORK", USER_MESSAGE.NETWORK);
}

/* ─────────────────────────────────────────────
   Λειτουργίες
   ───────────────────────────────────────────── */

export async function uploadObject(path: string, body: Uint8Array, contentType: string) {
  const { url, key } = config();
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
  } catch (e) {
    throw networkError("upload", e);
  }
  if (!res.ok) throw await responseError("upload", res);
}

/** Σβήνει αρχεία. Δεν πετά σφάλμα: ένα ορφανό αρχείο δεν σπάει τη ροή. */
export async function removeObjects(paths: string[]): Promise<void> {
  const list = paths.filter((p) => p && !/^https?:/i.test(p));
  if (list.length === 0 || !storageConfigured()) return;
  const { url, key } = config();
  try {
    const res = await fetch(`${url}/storage/v1/object/${STORAGE_BUCKET}`, {
      method: "DELETE",
      headers: { ...headers(key), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: list }),
      cache: "no-store",
    });
    if (!res.ok) await responseError("remove", res);
  } catch (e) {
    networkError("remove", e);
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
  if (todo.length === 0) return out;
  const problem = storageStartupProblem();
  if (problem) {
    console.error(`Storage sign: ${problem.code} — ${problem.message}`);
    return out;
  }
  const { url, key } = config();

  try {
    const res = await fetch(`${url}/storage/v1/object/sign/${STORAGE_BUCKET}`, {
      method: "POST",
      headers: { ...headers(key), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: seconds, paths: Array.from(new Set(todo)) }),
      cache: "no-store",
    });
    if (!res.ok) {
      await responseError("sign", res);
      return out;
    }
    const rows = (await res.json()) as { path?: string; signedURL?: string | null; error?: unknown }[];
    for (const r of rows) {
      if (r.path && r.signedURL) out.set(r.path, `${url}/storage/v1${r.signedURL}`);
    }
  } catch (e) {
    networkError("sign", e);
  }
  return out;
}
