// src/lib/public/insuranceLevelsServer.ts
// Τα επίπεδα ασφάλειας μιας εταιρίας από τη βάση — ΜΟΝΟ server.

import { db } from "../db";
import { toInsuranceLevelDTO } from "./insuranceLevels";

export const listInsuranceLevels = async (companyId: string) =>
  (
    await db.extra.findMany({
      where: { tenantId: companyId, type: "INSURANCE" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
  ).map(toInsuranceLevelDTO);
