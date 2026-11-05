import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, requireAuth } from "@/lib/api";
import { mapWallet } from "@/lib/serialize";
import { getSettings } from "@/lib/settings";

/** GET /api/wallet — balance, limits config, today's usage. */
export const GET = route(async (req: NextRequest) => {
  const session = await requireAuth(req);
  const wallet = await db.wallet.findUnique({ where: { userId: session.uid } });
  if (!wallet) return ok({ wallet: null, settings: null, usage: null });

  const settings = await getSettings();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [depositsToday, stakedToday] = await Promise.all([
    db.deposit.aggregate({ where: { userId: session.uid, status: "SUCCESS", createdAt: { gte: startOfDay } }, _sum: { amountCents: true } }),
    db.bet.aggregate({
      where: { userId: session.uid, createdAt: { gte: startOfDay }, status: { in: ["OPEN", "WON", "LOST", "CASHED_OUT", "PENDING_ACCEPTANCE"] } },
      _sum: { stakeCents: true },
    }),
  ]);

  return ok({
    wallet: mapWallet(wallet),
    settings: {
      minDepositCents: settings.minDepositCents,
      maxDepositCents: settings.maxDepositCents,
      minWithdrawalCents: settings.minWithdrawalCents,
      maxWithdrawalCents: settings.maxWithdrawalCents,
      minStakeCents: settings.minStakeCents,
      maxStakeCents: settings.maxStakeCents,
      welcomeBonusPercent: settings.welcomeBonusPercent,
      referralBonusCents: settings.referralBonusCents,
    },
    usage: {
      depositedTodayCents: depositsToday._sum.amountCents ?? 0,
      stakedTodayCents: stakedToday._sum.stakeCents ?? 0,
    },
  });
});
