// src/lib/loginLockStore.ts
// Ο store του loginLock.ts στο rate_limits — ΜΟΝΟ server, κανένα νέο SQL.
// · Λάθη: μία γραμμή ανά (κλειδί, λεπτό) με μετρητή → κυλιόμενο παράθυρο.
// · Κλείδωμα: γραμμή (κλειδί, windowStart = ΛΗΞΗ του κλειδώματος). Το
//   καθάρισμα του rate_limits σβήνει μόνο γραμμές παλιότερες από 1 ημέρα.

import { db } from "./db";
import type { LoginLockStore } from "./loginLock";

const minute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

export const dbLoginLockStore: LoginLockStore = {
  async addFailure(key, now) {
    await db.$executeRaw`
      INSERT INTO "rate_limits" ("key", "windowStart", "count") VALUES (${key}, ${minute(now)}, 1)
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "rate_limits"."count" + 1`;
  },
  async failuresSince(key, since) {
    const rows = await db.$queryRaw<{ n: number | null }[]>`
      SELECT COALESCE(SUM("count"), 0)::int AS "n" FROM "rate_limits"
      WHERE "key" = ${key} AND "windowStart" >= ${minute(since)}`;
    return Number(rows[0]?.n ?? 0);
  },
  async lockedUntil(key, now) {
    const rows = await db.$queryRaw<{ until: Date | null }[]>`
      SELECT MAX("windowStart") AS "until" FROM "rate_limits" WHERE "key" = ${key} AND "windowStart" > ${now}`;
    return rows[0]?.until ?? null;
  },
  async lock(key, until) {
    await db.$executeRaw`
      INSERT INTO "rate_limits" ("key", "windowStart", "count") VALUES (${key}, ${until}, 1)
      ON CONFLICT ("key", "windowStart") DO NOTHING`;
  },
  async clearFailures(key) {
    await db.$executeRaw`DELETE FROM "rate_limits" WHERE "key" = ${key}`;
  },
};
