import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { adminSelectionUpdateSchema } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { roundOdds } from "@/lib/money";
import { emitToRoom } from "@/lib/worker/realtime-client";

/** PATCH /api/admin/selections/:id — odds adjustment / suspend a selection. */
export const PATCH = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const data = adminSelectionUpdateSchema.parse(await readJson(req));

  const selection = await db.selection.findUnique({
    where: { id },
    include: { market: { select: { eventId: true } } },
  });
  if (!selection) return fail("Selection not found", 404, "NOT_FOUND");

  const updated = await db.selection.update({
    where: { id },
    data: {
      ...(data.odds !== undefined ? { prevOdds: selection.odds, odds: roundOdds(data.odds) } : {}),
      ...(data.status ? { status: data.status } : {}),
    },
  });

  // push the odds change to clients in realtime
  emitToRoom(`event:${selection.market.eventId}`, "odds_update", {
    eventId: selection.market.eventId,
    markets: [
      {
        marketId: selection.marketId,
        selections: [{ selectionId: updated.id, odds: updated.odds, prevOdds: updated.prevOdds, status: updated.status }],
      },
    ],
  });

  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: data.odds !== undefined ? "ODDS_UPDATE" : "SELECTION_UPDATE",
    entity: "selection",
    entityId: id,
    ip: clientIp(req),
    details: data,
  });

  return ok({ selection: { id: updated.id, odds: updated.odds, status: updated.status } });
});
