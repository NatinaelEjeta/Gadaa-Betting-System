import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { adminMarketUpdateSchema } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { settleBet } from "@/lib/settlement";

/**
 * PATCH /api/admin/markets/:id — suspend/reopen a market or override its
 * result manually (resultName + status SETTLED), then re-settle affected bets.
 */
export const PATCH = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const data = adminMarketUpdateSchema.parse(await readJson(req));

  const market = await db.market.findUnique({ where: { id } });
  if (!market) return fail("Market not found", 404, "NOT_FOUND");

  await db.market.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.resultName !== undefined ? { resultName: data.resultName } : {}),
      ...(data.status === "SETTLED" || data.resultName !== undefined ? { settledAt: new Date() } : {}),
      ...(data.status === "SUSPENDED" ? { suspendedAt: new Date() } : {}),
      ...(data.status === "OPEN" ? { suspendedAt: null } : {}),
    },
  });

  // If the result was manually overridden, re-settle open bets containing this market
  if (data.resultName !== undefined || data.status === "SETTLED") {
    const legs = await db.betLeg.findMany({
      where: { marketId: id },
      select: { betId: true },
      distinct: ["betId"],
    });
    for (const leg of legs) {
      await settleBet(leg.betId);
    }
  }

  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: "MARKET_UPDATE",
    entity: "market",
    entityId: id,
    ip: clientIp(req),
    details: data,
  });

  return ok({ updated: true });
});
