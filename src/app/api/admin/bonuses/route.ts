import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { adminBonusSchema } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

/** GET /api/admin/bonuses — promotion management. */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req, ["FINANCE", "ADMIN", "SUPER_ADMIN"]);
  const bonuses = await db.bonus.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { grants: true } } } });
  const grants = await db.bonusGrant.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { user: { select: { id: true, phone: true, fullName: true } } },
  });
  return ok({
    bonuses: bonuses.map((b) => ({ ...b, createdAt: b.createdAt.toISOString(), grantsCount: b._count.grants })),
    grants: grants.map((g) => ({
      id: g.id,
      amountCents: g.amountCents,
      status: g.status,
      reason: g.reason,
      createdAt: g.createdAt.toISOString(),
      user: g.user,
    })),
  });
});

/** POST /api/admin/bonuses — create/update a promotion. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const data = adminBonusSchema.parse(await readJson(req));
  const bonus = await db.bonus.create({ data });
  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: "BONUS_CREATE",
    entity: "bonus",
    entityId: bonus.id,
    ip: clientIp(req),
    details: data,
  });
  return ok({ bonus }, { status: 201 });
});
