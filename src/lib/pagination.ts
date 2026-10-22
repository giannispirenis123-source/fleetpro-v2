// src/lib/pagination.ts
// Σελιδοποίηση λιστών στον server (κρατήσεις, πελάτες, τιμολόγια) — καθαρή
// λογική, χωρίς db. Ίδιο μοτίβο με τα συμβόλαια (loadContractList): page/limit
// με ΣΤΑΘΕΡΗ ταξινόμηση (πάντα και id στο τέλος) και ανώτατο όριο ανά αίτημα.

export const LIST_PAGE_SIZE = 50;
/** Κανένα αίτημα δεν φέρνει περισσότερες γραμμές από αυτό. */
export const LIST_MAX_PAGE_SIZE = 100;
/** Παράλογα μεγάλη σελίδα (π.χ. ?page=999999999) δεν περνά στη βάση ως τεράστιο OFFSET. */
export const LIST_MAX_PAGE = 2000;

export interface ListPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** "?page=" → ακέραιος 1..LIST_MAX_PAGE (άκυρο → 1). */
export function parsePage(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim() || "1");
  if (!Number.isFinite(n)) return 1;
  return Math.min(LIST_MAX_PAGE, Math.max(1, Math.floor(n)));
}

/** skip/take για τη σελίδα, με ανώτατο όριο μεγέθους. */
export function pageWindow(page: number, size = LIST_PAGE_SIZE): { skip: number; take: number } {
  const take = Math.min(LIST_MAX_PAGE_SIZE, Math.max(1, Math.floor(size)));
  return { skip: (parsePage(page) - 1) * take, take };
}

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));

/**
 * Λέξεις αναζήτησης: κάθε λέξη πρέπει να ταιριάζει σε ΚΑΠΟΙΟ πεδίο (AND από OR).
 * Έως 5 λέξεις των 60 χαρακτήρων — όχι ατελείωτα LIKE.
 */
export function searchWords(q: unknown): string[] {
  if (typeof q !== "string") return [];
  return q
    .trim()
    .split(/\s+/)
    .map((w) => w.slice(0, 60))
    .filter(Boolean)
    .slice(0, 5);
}

/** Prisma where για τις λέξεις: `fields(word)` = τα OR ενός πεδίου ανά λέξη. */
export function wordsWhere<W>(words: string[], fields: (word: string) => W[]): { AND: { OR: W[] }[] } | Record<string, never> {
  return words.length ? { AND: words.map((w) => ({ OR: fields(w) })) } : {};
}
