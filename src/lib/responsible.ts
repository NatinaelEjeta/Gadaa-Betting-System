import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";

/**
 * Responsible-gambling enforcement: self-exclusion, cooling-off, and
 * per-day deposit / stake / loss limits. Called before every deposit & bet.
 */

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function assertNotExcluded(userId: string) {
  const exclusion = await db.selfExclusion.findFirst({
    where: { userId, active: true, until: { gt: new Date() } },
    orderBy: { until: "desc" },
  });
  if (exclusion) {
    throw new ApiError(
      `Account is self-excluded until ${exclusion.until.toISOString().slice(0, 10)}`,
      403,
      "SELF_EXCLUDED"
    );
  }
  const limits = await db.responsibleLimit.findUnique({ where: { userId } });
  if (limits?.coolingOffUntil && limits.coolingOffUntil > new Date()) {
    throw new ApiError(
      `Cooling-off period active until ${limits.coolingOffUntil.toISOString().slice(0, 16).replace("T", " ")} UTC`,
      403,
      "COOLING_OFF"
    );
  }
}

export async function assertCanDeposit(userId: string, amountCents: number) {
  await assertNotExcluded(userId);
  const limits = await db.responsibleLimit.findUnique({ where: { userId } });
  if (limits?.dailyDepositLimitCents && limits.dailyDepositLimitCents > 0) {
    const agg = await db.deposit.aggregate({
      where: { userId, status: "SUCCESS", createdAt: { gte: startOfToday() } },
      _sum: { amountCents: true },
    });
    const deposited = agg._sum.amountCents ?? 0;
    if (deposited + amountCents > limits.dailyDepositLimitCents) {
      throw new ApiError("Daily deposit limit would be exceeded", 403, "DEPOSIT_LIMIT");
    }
  }
}

export async function assertCanStake(userId: string, stakeCents: number) {
  await assertNotExcluded(userId);
  const limits = await db.responsibleLimit.findUnique({ where: { userId } });
  if (!limits) return;

  if (limits.dailyStakeLimitCents && limits.dailyStakeLimitCents > 0) {
    const agg = await db.bet.aggregate({
      where: {
        userId,
        createdAt: { gte: startOfToday() },
        status: { in: ["OPEN", "WON", "LOST", "CASHED_OUT", "PENDING_ACCEPTANCE"] },
      },
      _sum: { stakeCents: true },
    });
    const staked = agg._sum.stakeCents ?? 0;
    if (staked + stakeCents > limits.dailyStakeLimitCents) {
      throw new ApiError("Daily stake limit would be exceeded", 403, "STAKE_LIMIT");
    }
  }

  if (limits.lossLimitCents && limits.lossLimitCents > 0) {
    const agg = await db.bet.aggregate({
      where: { userId, status: "LOST", settledAt: { gte: startOfToday() } },
      _sum: { stakeCents: true },
    });
    const lost = agg._sum.stakeCents ?? 0;
    if (lost >= limits.lossLimitCents) {
      throw new ApiError("Daily loss limit reached — take a break", 403, "LOSS_LIMIT");
    }
  }
}
