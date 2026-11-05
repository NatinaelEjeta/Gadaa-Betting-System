import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { depositSchema } from "@/lib/validation";
import { createDeposit } from "@/lib/payments";
import { logAudit } from "@/lib/audit";

/** GET /api/deposits — my deposit history. */
export const GET = route(async (req: NextRequest) => {
  const session = await requireAuth(req);
  const deposits = await db.deposit.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true, txRef: true, amountCents: true, status: true,
      checkoutUrl: true, createdAt: true, creditedAt: true,
    },
  });
  return ok({ deposits });
});

/** POST /api/deposits — initialize a Chapa deposit, returns the checkout URL. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const user = await db.user.findUniqueOrThrow({ where: { id: session.uid } });
  if (user.status !== "ACTIVE") {
    return ok({ error: "Account not active" }, { status: 403 });
  }
  const { amountCents } = depositSchema.parse(await readJson(req));

  const result = await createDeposit({ id: user.id, phone: user.phone, fullName: user.fullName }, amountCents);
  await logAudit({
    actorId: user.id,
    action: "DEPOSIT_INIT",
    entity: "deposit",
    entityId: result.depositId,
    ip: clientIp(req),
    details: { amountCents, txRef: result.txRef },
  });
  return ok(result);
});
