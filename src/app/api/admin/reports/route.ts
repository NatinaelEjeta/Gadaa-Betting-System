import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, requireAuth } from "@/lib/api";
import { ReportDTO } from "@/lib/serialize";

/**
 * GET /api/admin/reports?range=7|28|180 — financial report (daily buckets):
 * deposits, withdrawals paid, stakes volume, payouts, GGR, bets, new users.
 * Money figures come from the double-entry ledger (source of truth).
 */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req, ["FINANCE", "ADMIN", "SUPER_ADMIN"]);
  const url = new URL(req.url);
  const range = Math.min(365, Math.max(7, Number.parseInt(url.searchParams.get("range") ?? "28", 10)));
  const since = new Date(Date.now() - range * 86_400_000);
  since.setHours(0, 0, 0, 0);

  const [ledger, usersCount, openBets, pendingWithdrawals, pendingKyc, betsSince] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { createdAt: { gte: since }, entryType: { in: ["DEPOSIT", "WITHDRAWAL_SETTLE", "BET_STAKE", "BET_WIN", "BET_REFUND", "CASHOUT"] } },
      select: { entryType: true, amountCents: true, createdAt: true },
    }),
    db.user.count({ where: { createdAt: { gte: since }, role: "USER" } }),
    db.bet.count({ where: { status: { in: ["OPEN", "PENDING_ACCEPTANCE"] } } }),
    db.withdrawal.aggregate({ where: { status: "PENDING" }, _sum: { amountCents: true } }),
    db.kycDocument.count({ where: { status: "PENDING" } }),
    db.bet.aggregate({ where: { createdAt: { gte: since } }, _count: true }),
  ]);

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const days = new Map<string, ReportDTO["days"][number]>();
  for (let i = 0; i < range; i++) {
    const key = dayKey(new Date(Date.now() - i * 86_400_000));
    days.set(key, { date: key, depositsCents: 0, withdrawalsCents: 0, stakesCents: 0, payoutsCents: 0, ggrCents: 0, betsCount: 0, newUsers: 0 });
  }

  for (const e of ledger) {
    const row = days.get(dayKey(e.createdAt));
    if (!row) continue;
    if (e.entryType === "DEPOSIT") row.depositsCents += e.amountCents;
    else if (e.entryType === "WITHDRAWAL_SETTLE") row.withdrawalsCents += e.amountCents;
    else if (e.entryType === "BET_STAKE") row.stakesCents += e.amountCents;
    else row.payoutsCents += e.amountCents; // BET_WIN / BET_REFUND / CASHOUT
  }
  const usersByDay = await db.user.findMany({
    where: { createdAt: { gte: since }, role: "USER" },
    select: { createdAt: true },
  });
  for (const u of usersByDay) {
    const row = days.get(dayKey(u.createdAt));
    if (row) row.newUsers += 1;
  }
  const betsByDay = await db.bet.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
  });
  for (const b of betsByDay) {
    const row = days.get(dayKey(b.createdAt));
    if (row) row.betsCount += 1;
  }

  const dayRows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const row of dayRows) {
    row.ggrCents = row.stakesCents - row.payoutsCents;
  }

  const totals = dayRows.reduce(
    (acc, d) => ({
      depositsCents: acc.depositsCents + d.depositsCents,
      withdrawalsCents: acc.withdrawalsCents + d.withdrawalsCents,
      stakesCents: acc.stakesCents + d.stakesCents,
      payoutsCents: acc.payoutsCents + d.payoutsCents,
      ggrCents: acc.ggrCents + d.ggrCents,
      betsCount: acc.betsCount + d.betsCount,
      usersCount,
      openBetsCount: openBets,
      pendingWithdrawalsCents: pendingWithdrawals._sum.amountCents ?? 0,
      pendingKycCount: pendingKyc,
    }),
    {
      depositsCents: 0, withdrawalsCents: 0, stakesCents: 0, payoutsCents: 0,
      ggrCents: 0, betsCount: 0, usersCount, openBetsCount: openBets,
      pendingWithdrawalsCents: 0, pendingKycCount: 0,
    }
  );
  totals.betsCount = betsSince._count;
  totals.pendingWithdrawalsCents = pendingWithdrawals._sum.amountCents ?? 0;

  const report: ReportDTO = { days: dayRows, totals };
  return ok(report);
});
