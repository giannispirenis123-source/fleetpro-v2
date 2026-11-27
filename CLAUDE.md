# CLAUDE.md

## Κανόνες για SQL migrations

- Τα SQL αρχεία μπαίνουν στο `prisma/sql/` με αύξοντα αριθμό (`NN-περιγραφή.sql`).
- Κάθε νέο SQL που φτιάχνει πίνακα στο schema `public` πρέπει να τελειώνει με
  `ALTER TABLE public."<πίνακας>" ENABLE ROW LEVEL SECURITY;` για αυτόν τον πίνακα
  (βλ. `prisma/sql/42-enable-rls.sql`). Χωρίς policies: η εφαρμογή δουλεύει με Prisma.
