import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, requireAuth } from "@/lib/api";

/** GET /api/admin/audit-logs?action=&page= — full audit trail. */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req, ["SUPPORT", "FINANCE", "ADMIN", "SUPER_ADMIN"]);
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));

  const where = action ? { action } : {};
  const [total, logs] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 30,
      take: 30,
    }),
  ]);

  return ok({
    logs: logs.map((l) => ({
      id: l.id,
      actorId: l.actorId,
      actorPhone: l.actorPhone,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      details: l.detailsJson ? JSON.parse(l.detailsJson) : null,
      ip: l.ip,
      createdAt: l.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / 30)),
  });
});
