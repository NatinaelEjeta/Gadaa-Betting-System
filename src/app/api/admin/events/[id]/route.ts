import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { adminEventUpdateSchema, adminSettleSchema } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { settleFinishedEvents } from "@/lib/settlement";
import { emitToRoom } from "@/lib/worker/realtime-client";

/** PATCH /api/admin/events/:id — update status / scores / minute / featured. */
export const PATCH = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const data = adminEventUpdateSchema.parse(await readJson(req));

  const event = await db.event.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.homeScore !== undefined ? { homeScore: data.homeScore } : {}),
      ...(data.awayScore !== undefined ? { awayScore: data.awayScore } : {}),
      ...(data.minute !== undefined ? { minute: data.minute } : {}),
      ...(data.featured !== undefined ? { featured: data.featured } : {}),
      // re-opening settlement when scores are corrected
      ...(data.homeScore !== undefined || data.awayScore !== undefined ? { settledAt: null } : {}),
    },
  });

  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: "EVENT_UPDATE",
    entity: "event",
    entityId: id,
    ip: clientIp(req),
    details: data,
  });
  return ok({ event: { id: event.id, status: event.status, homeScore: event.homeScore, awayScore: event.awayScore } });
});

/** POST /api/admin/events/:id — manual settlement with a final score. */
export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const data = adminSettleSchema.parse(await readJson(req));

  const event = await db.event.findUnique({ where: { id } });
  if (!event) return fail("Event not found", 404, "NOT_FOUND");
  if (event.settledAt) return fail("Event already settled", 400, "ALREADY_SETTLED");

  await db.event.update({
    where: { id },
    data: { homeScore: data.homeScore, awayScore: data.awayScore, status: "FINISHED", settledAt: null },
  });

  const notifications = await settleFinishedEvents(50);
  for (const n of notifications) {
    emitToRoom(`user:${n.userId}`, "notify", { kind: n.kind, message: n.message });
  }

  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: "EVENT_MANUAL_SETTLE",
    entity: "event",
    entityId: id,
    ip: clientIp(req),
    details: { homeScore: data.homeScore, awayScore: data.awayScore, settledBets: notifications.length },
  });

  return ok({ settled: true, payouts: notifications.length });
});
