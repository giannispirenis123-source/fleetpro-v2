// src/components/errors/digest.ts — καθαρή λογική (και για tests).
/** Μόνο ο κωδικός digest (σύντομο hash του Next) — τίποτα άλλο από το σφάλμα. */
export const safeDigest = (digest: unknown): string | null =>
  typeof digest === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(digest) ? digest : null;
