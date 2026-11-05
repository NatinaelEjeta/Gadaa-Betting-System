import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { adminUserUpdateSchema } from "@/lib/validation";
import { logAudit, notify } from "@/lib/audit";

/** PATCH /api/admin/users/:id — ban / suspend / reactivate, change role. */
export const PATCH = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const data = adminUserUpdateSchema.parse(await readJson(req));

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return fail("User not found", 404, "NOT_FOUND");
  if (target.id === session.uid) return fail("You cannot modify your own account here", 400, "SELF_MODIFICATION");
  if (data.role && session.role !== "SUPER_ADMIN") {
    return fail("Only a Super Admin can change roles", 403, "FORBIDDEN");
  }
  if (target.role === "SUPER_ADMIN" && session.role !== "SUPER_ADMIN") {
    return fail("Cannot modify a Super Admin", 403, "FORBIDDEN");
  }

  const user = await db.user.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.role ? { role: data.role } : {}),
    },
  });

  if (data.status && data.status !== "ACTIVE") {
    await notify(user.id, "SYSTEM", "Account update", `Your account has been ${data.status.toLowerCase()}.`);
  }

  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: data.status ? `USER_${data.status}` : "USER_ROLE_CHANGE",
    entity: "user",
    entityId: id,
    ip: clientIp(req),
    details: data,
  });

  return ok({ user: { id: user.id, status: user.status, role: user.role } });
});
