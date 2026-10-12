export const dynamic = "force-dynamic";
// src/app/api/public-site/rates/route.ts
// Σεζόν & Τιμές: πίνακας (ομάδα ή όχημα χωρίς ομάδα) × (σεζόν ή «όλο τον χρόνο»).
// GET → { seasons, targets, rates }   PUT → αποθήκευση ενός κελιού (κλίμακες σε cents)
// Ομάδα, όχημα και σεζόν ελέγχονται ότι ανήκουν στην εταιρία της συνεδρίας.

import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { toCents } from "@/lib/public/money";
import { tiersProblem } from "@/lib/public/rates";
import { readTiers } from "@/lib/public/server";
import { readLocalized } from "@/lib/public/text";

const tierSchema = z.object({
  minDays: z.number().int().min(1).max(365),
  maxDays: z.number().int().min(1).max(365).nullable(),
  dailyPriceCents: z.number().int().min(0).max(10_000_000),
});

const putSchema = z.object({
  seasonId: z.string().max(64).nullable(),
  target: z.object({ kind: z.enum(["group", "vehicle"]), id: z.string().min(1).max(64) }),
  tiers: z.array(tierSchema).max(20),
});

async function loadAll(companyId: string) {
  const [seasons, groups, vehicles, rates] = await Promise.all([
    db.season.findMany({ where: { tenantId: companyId }, orderBy: [{ sortOrder: "asc" }, { startMonthDay: "asc" }] }),
    db.rentalGroup.findMany({ where: { tenantId: companyId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    db.vehicle.findMany({
      where: { tenantId: companyId, isActive: true, rentalGroupId: null },
      select: { id: true, brand: true, model: true, plate: true, dailyRate: true, vehicleType: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
    }),
    db.rate.findMany({ where: { tenantId: companyId } }),
  ]);
  return {
    seasons: seasons.map((s) => ({
      id: s.id,
      name: readLocalized(s.name),
      startMonthDay: s.startMonthDay,
      endMonthDay: s.endMonthDay,
      minDays: s.minDays,
      priority: s.priority,
    })),
    targets: [
      ...groups.map((g) => ({
        kind: "group" as const,
        id: g.id,
        label: `${g.code} · ${readLocalized(g.name).el ?? ""}`.trim(),
        vehicleType: g.vehicleType,
        basePriceCents: g.basePriceCents,
        isActive: g.isActive,
      })),
      ...vehicles.map((v) => ({
        kind: "vehicle" as const,
        id: v.id,
        label: `${v.brand} ${v.model} (${v.plate})`,
        vehicleType: v.vehicleType,
        basePriceCents: toCents(v.dailyRate),
        isActive: true,
      })),
    ],
    rates: rates.map((r) => ({
      seasonId: r.seasonId,
      rentalGroupId: r.rentalGroupId,
      vehicleId: r.vehicleId,
      tiers: readTiers(r.tiers),
    })),
  };
}

// GET /api/public-site/rates
export const GET = withPublicSite(async (_req, companyId) => {
  try {
    return ok(await loadAll(companyId));
  } catch (error) {
    console.error("[FleetPro] public-site rates GET:", error instanceof Error ? error.name : "");
    return serverError();
  }
});

// PUT /api/public-site/rates — ένα κελί· κενές κλίμακες = διαγραφή του κελιού
export const PUT = withPublicSite(async (req, companyId) => {
  try {
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest("Μη έγκυρες κλίμακες τιμών", parsed.error.errors);
    const { seasonId, target, tiers } = parsed.data;

    const problem = tiersProblem(tiers);
    if (problem) return badRequest(problem);

    // Όλα πρέπει να ανήκουν στην εταιρία της συνεδρίας.
    const [season, owner] = await Promise.all([
      seasonId ? db.season.findFirst({ where: { id: seasonId, tenantId: companyId }, select: { id: true } }) : null,
      target.kind === "group"
        ? db.rentalGroup.findFirst({ where: { id: target.id, tenantId: companyId }, select: { id: true } })
        : db.vehicle.findFirst({ where: { id: target.id, tenantId: companyId }, select: { id: true } }),
    ]);
    if ((seasonId && !season) || !owner) return notFound();

    const key = {
      tenantId: companyId,
      seasonId,
      rentalGroupId: target.kind === "group" ? target.id : null,
      vehicleId: target.kind === "vehicle" ? target.id : null,
    };
    const sorted = [...tiers].sort((a, b) => a.minDays - b.minDays);

    await db.$transaction(async (tx) => {
      const existing = await tx.rate.findFirst({ where: key, select: { id: true } });
      if (sorted.length === 0) {
        if (existing) await tx.rate.delete({ where: { id: existing.id } });
      } else if (existing) {
        await tx.rate.update({ where: { id: existing.id }, data: { tiers: sorted } });
      } else {
        await tx.rate.create({ data: { ...key, tiers: sorted } });
      }
    });
    return ok(await loadAll(companyId));
  } catch (error) {
    console.error("[FleetPro] public-site rates PUT:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
