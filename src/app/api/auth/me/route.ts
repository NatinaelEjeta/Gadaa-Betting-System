import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route } from "@/lib/api";
import { getSessionFromRequest } from "@/lib/auth";
import { mapWallet } from "@/lib/serialize";

/**
 * GET /api/auth/me — current user profile + wallet + KYC status + limits.
 * Returns { user: null } (200) when unauthenticated so the SPA can react
 * cleanly (a 401 here would poison the React Query cache with stale data).
 */
export const GET = route(async (req: NextRequest) => {
  const session = await getSessionFromRequest(req);
  if (!session) return ok({ user: null });

  const user = await db.user.findUnique({
    where: { id: session.uid },
    include: {
      wallet: true,
      limits: true,
      kycDocuments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!user) return ok({ user: null });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [depositsToday, stakesToday] = await Promise.all([
    db.deposit.aggregate({ where: { userId: user.id, status: "SUCCESS", createdAt: { gte: startOfDay } }, _sum: { amountCents: true } }),
    db.bet.aggregate({
      where: {
        userId: user.id,
        createdAt: { gte: startOfDay },
        status: { in: ["OPEN", "WON", "LOST", "CASHED_OUT", "PENDING_ACCEPTANCE"] },
      },
      _sum: { stakeCents: true },
    }),
  ]);

  return ok({
    user: {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      phoneVerified: user.phoneVerified,
      language: user.language,
      referralCode: user.referralCode,
      createdAt: user.createdAt.toISOString(),
      dateOfBirth: user.dateOfBirth,
      kycStatus: user.kycDocuments[0]?.status ?? "NONE",
      limits: user.limits
        ? {
            dailyDepositLimitCents: user.limits.dailyDepositLimitCents,
            dailyStakeLimitCents: user.limits.dailyStakeLimitCents,
            lossLimitCents: user.limits.lossLimitCents,
            coolingOffUntil: user.limits.coolingOffUntil?.toISOString() ?? null,
          }
        : null,
      wallet: user.wallet ? mapWallet(user.wallet) : null,
      usage: {
        depositedTodayCents: depositsToday._sum.amountCents ?? 0,
        stakedTodayCents: stakesToday._sum.stakeCents ?? 0,
      },
    },
  });
});
