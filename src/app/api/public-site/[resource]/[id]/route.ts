export const dynamic = "force-dynamic";
// src/app/api/public-site/[resource]/[id]/route.ts
// Δημόσιο site — αλλαγή / διαγραφή μίας εγγραφής. Πάντα με where { id, tenantId }:
// εγγραφή άλλης εταιρίας = 404. Σε χρήση (π.χ. ομάδα με οχήματα) → «Ανενεργή».

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { RESOURCES, isResource } from "@/lib/public/resources";

const firstError = (e: { errors: { message: string }[] }) => e.errors[0]?.message ?? "Μη έγκυρα δεδομένα";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// PATCH /api/public-site/[resource]/[id] — ΟΛΗ η εγγραφή (όπως η φόρμα)
export const PATCH = withPublicSite(async (req, companyId, params) => {
  try {
    if (!isResource(params.resource) || !ID_RE.test(params.id)) return notFound();
    const def = RESOURCES[params.resource];
    const current = await def.delegate().findFirst({ where: { id: params.id, tenantId: companyId }, select: { id: true } });
    if (!current) return notFound();

    const parsed = def.schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(firstError(parsed.error), parsed.error.errors);
    const problem = def.check ? await def.check(companyId, parsed.data, params.id) : null;
    if (problem) return badRequest(problem);

    try {
      const row = await def.delegate().update({
        where: { id: current.id },
        data: parsed.data,
        ...(def.include && { include: def.include }),
      });
      await def.afterSave?.(companyId, row);
      return ok({ item: def.toDTO(row) });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return badRequest(def.uniqueMessage ?? "Υπάρχει ήδη εγγραφή με αυτά τα στοιχεία");
      }
      throw e;
    }
  } catch (error) {
    console.error(`[FleetPro] public-site ${params.resource} PATCH:`, error instanceof Error ? error.name : "");
    return serverError();
  }
});

// DELETE /api/public-site/[resource]/[id]
// → { deleted: true } ή { deactivated: true, item } όταν είναι σε χρήση.
export const DELETE = withPublicSite(async (_req, companyId, params) => {
  try {
    if (!isResource(params.resource) || !ID_RE.test(params.id)) return notFound();
    const def = RESOURCES[params.resource];
    const current = await def.delegate().findFirst({ where: { id: params.id, tenantId: companyId }, select: { id: true } });
    if (!current) return notFound();

    if (def.inUse && def.deactivate && (await def.inUse(companyId, current.id))) {
      const row = await def.delegate().update({
        where: { id: current.id },
        data: def.deactivate,
        ...(def.include && { include: def.include }),
      });
      return ok({ deactivated: true, item: def.toDTO(row) });
    }
    const blocked = def.beforeDelete ? await def.beforeDelete(companyId, current.id) : null;
    if (blocked) return NextResponse.json({ success: false, message: blocked }, { status: 502 });
    await def.delegate().delete({ where: { id: current.id } });
    return ok({ deleted: true });
  } catch (error) {
    console.error(`[FleetPro] public-site ${params.resource} DELETE:`, error instanceof Error ? error.name : "");
    return serverError();
  }
});
