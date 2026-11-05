import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, requireAuth, assertSameOrigin } from "@/lib/api";

/** GET /api/notifications — latest notifications. */
export const GET = route(async (req: NextRequest) => {
  const session = await requireAuth(req);
  const rows = await db.notification.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const unread = await db.notification.count({ where: { userId: session.uid, read: false } });
  return ok({
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    })),
    unread,
  });
});

/** POST /api/notifications — mark all (or given ids) as read. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const body = await readJson<{ ids?: string[] }>(req).catch(() => ({}) as { ids?: string[] });
  await db.notification.updateMany({
    where: { userId: session.uid, ...(body.ids?.length ? { id: { in: body.ids } } : {}) },
    data: { read: true },
  });
  return ok({ marked: true });
});
