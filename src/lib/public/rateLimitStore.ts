// src/lib/public/rateLimitStore.ts
// Ο μετρητής του rateLimit.ts στη βάση (rate_limits) — ΜΟΝΟ server.
// Ένα ατομικό INSERT … ON CONFLICT … RETURNING ανά χτύπημα· καθάρισμα παλιών
// παραθύρων περιστασιακά (1 στις 50 κλήσεις).

import { db } from "../db";
import type { CounterStore } from "./rateLimit";

export const dbCounterStore: CounterStore = {
  async increment(key, windowStart) {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "rate_limits" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "rate_limits"."count" + 1
      RETURNING "count"`;
    if (Math.random() < 0.02) {
      await db.$executeRaw`DELETE FROM "rate_limits" WHERE "windowStart" < now() - interval '1 day'`;
    }
    return Number(rows[0]?.count ?? 1);
  },
};
