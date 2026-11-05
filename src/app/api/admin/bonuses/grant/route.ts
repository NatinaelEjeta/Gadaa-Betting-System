import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { adminGrantBonusSchema } from "@/lib/validation";
import { mutateWallet, COUNTER_ACCOUNTS } from "@/lib/wallet";
import { notify, logAudit } from "@/lib/audit";

/** POST /api/admin/bonuses/grant — manually credit a bonus to a user. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const data = adminGrantBonusSchema.parse(await readJson(req));

  const user = await db.user.findUnique({ where: { id: data.userId } });
  if (!user) return fail("User not found", 404, "NOT_FOUND");

  await mutateWallet([
    {
      userId: user.id,
      deltaCents: data.amountCents,
      bonusDeltaCents: data.amountCents,
      entryType: "BONUS",
      counterAccount: COUNTER_ACCOUNTS.PROMO_BONUS,
      refType: "bonus",
      description: data.reason ?? "Manual bonus grant",
      txRow: { type: "BONUS", status: "SUCCESS", amountCents: data.amountCents, description: data.reason ?? "Manual bonus" },
    },
  ]);
  await db.bonusGrant.create({
    data: { userId: user.id, amountCents: data.amountCents, reason: data.reason ?? "Manual grant by admin" },
  });
  await notify(user.id, "BONUS", "Bonus credited", `${data.amountCents / 100} ETB bonus added to your wallet.`);

  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: "BONUS_GRANT",
    entity: "user",
    entityId: user.id,
    ip: clientIp(req),
    details: { amountCents: data.amountCents, reason: data.reason },
  });

  return ok({ granted: true });
});
