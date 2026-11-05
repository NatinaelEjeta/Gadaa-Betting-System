import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, assertSameOrigin } from "@/lib/api";
import { limitsSchema, selfExcludeSchema } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

/** PUT /api/profile/limits — responsible-gambling limits + cooling-off. */
export const PUT = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const data = limitsSchema.parse(await readJson(req));

  const limits = await db.responsibleLimit.upsert({
    where: { userId: session.uid },
    update: {
      ...(data.dailyDepositLimitCents !== undefined ? { dailyDepositLimitCents: data.dailyDepositLimitCents } : {}),
      ...(data.dailyStakeLimitCents !== undefined ? { dailyStakeLimitCents: data.dailyStakeLimitCents } : {}),
      ...(data.lossLimitCents !== undefined ? { lossLimitCents: data.lossLimitCents } : {}),
      ...(data.coolingOffHours !== undefined && data.coolingOffHours !== null
        ? { coolingOffUntil: new Date(Date.now() + data.coolingOffHours * 3_600_000) }
        : {}),
    },
    create: {
      userId: session.uid,
      dailyDepositLimitCents: data.dailyDepositLimitCents ?? null,
      dailyStakeLimitCents: data.dailyStakeLimitCents ?? null,
      lossLimitCents: data.lossLimitCents ?? null,
      coolingOffUntil:
        data.coolingOffHours != null ? new Date(Date.now() + data.coolingOffHours * 3_600_000) : null,
    },
  });

  await logAudit({ actorId: session.uid, action: "LIMITS_UPDATE", entity: "user", entityId: session.uid, details: data });
  return ok({ limits });
});

/** POST /api/profile/limits — self-exclusion for N days. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const data = selfExcludeSchema.parse(await readJson(req));

  const until = new Date(Date.now() + data.days * 86_400_000);
  await db.selfExclusion.create({
    data: { userId: session.uid, until, reason: data.reason },
  });
  await db.responsibleLimit.upsert({
    where: { userId: session.uid },
    update: { coolingOffUntil: until },
    create: { userId: session.uid, coolingOffUntil: until },
  });

  await logAudit({
    actorId: session.uid,
    action: "SELF_EXCLUSION",
    entity: "user",
    entityId: session.uid,
    details: { days: data.days, until: until.toISOString() },
  });

  return ok({
    until: until.toISOString(),
    message: `You are self-excluded until ${until.toISOString().slice(0, 10)}. Deposits and betting are blocked until then.`,
  });
});
