import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { assertCanStake } from "@/lib/responsible";
import { applyMutations } from "@/lib/wallet";
import { COUNTER_ACCOUNTS } from "@/lib/wallet";
import { productOdds, potentialWin as calcPotentialWin, combinations, roundOdds } from "@/lib/money";
import { notify, logAudit } from "@/lib/audit";
import { Prisma } from "@prisma/client";

/**
 * Bet placement pipeline.
 *  1. Stake / structure validation (single, accumulator, system combos)
 *  2. Responsible-gambling checks (limits, exclusion, cooling-off)
 *  3. Selection validation: market OPEN, selection ACTIVE, event not started/finished
 *  4. One user may not combine two selections from the same market
 *  5. Atomic wallet debit + bet + legs in a single transaction
 *  6. Live bets enter PENDING_ACCEPTANCE for N seconds and are confirmed or
 *     voided (refunded) by the worker after verifying the odds did not move.
 */

interface PlaceBetInput {
  type: "SINGLE" | "MULTIPLE" | "SYSTEM";
  stakeCents: number;
  selectionIds: string[];
  systemK?: number;
  acceptOddsChange?: boolean;
}

export async function placeBet(
  user: { id: string; phone: string },
  input: PlaceBetInput,
  ip?: string
) {
  const settings = await getSettings();

  // ---- structure validation ----
  const { type, selectionIds } = input;
  let systemK = input.systemK ?? null;
  if (type === "SINGLE" && selectionIds.length !== 1) {
    throw new ApiError("A single bet needs exactly one selection", 422, "INVALID_STRUCTURE");
  }
  if (type === "MULTIPLE" && selectionIds.length < 2) {
    throw new ApiError("An accumulator needs at least 2 selections", 422, "INVALID_STRUCTURE");
  }
  if (type === "SYSTEM") {
    if (!systemK || systemK < 2) throw new ApiError("System bets need a combination size (e.g. 2 of 3)", 422, "INVALID_STRUCTURE");
    if (selectionIds.length <= systemK) {
      throw new ApiError(`A system ${systemK} needs at least ${systemK + 1} selections`, 422, "INVALID_STRUCTURE");
    }
  }
  if (type !== "SINGLE" && new Set(selectionIds).size !== selectionIds.length) {
    throw new ApiError("Duplicate selections are not allowed", 422, "INVALID_STRUCTURE");
  }
  if (selectionIds.length > settings.maxLegs) {
    throw new ApiError(`Maximum ${settings.maxLegs} selections per bet`, 422, "MAX_LEGS");
  }

  // stake validation
  let totalStakeCents = input.stakeCents;
  let stakePerCombo = input.stakeCents;
  let comboCount = 1;
  if (type === "SYSTEM") {
    comboCount = combinations(selectionIds.length, systemK!);
    stakePerCombo = input.stakeCents;
    totalStakeCents = input.stakeCents * comboCount;
  }
  if (totalStakeCents < settings.minStakeCents) {
    throw new ApiError(`Minimum stake is ${settings.minStakeCents / 100} ETB`, 400, "MIN_STAKE");
  }
  if (totalStakeCents > settings.maxStakeCents) {
    throw new ApiError(`Maximum stake is ${settings.maxStakeCents / 100} ETB`, 400, "MAX_STAKE");
  }

  // ---- responsible gambling ----
  await assertCanStake(user.id, totalStakeCents);

  // ---- load & validate selections ----
  const selections = await db.selection.findMany({
    where: { id: { in: selectionIds } },
    include: {
      market: {
        include: {
          event: {
            include: {
              homeTeam: true,
              awayTeam: true,
            },
          },
        },
      },
    },
  });
  if (selections.length !== selectionIds.length) {
    throw new ApiError("One or more selections no longer exist", 400, "SELECTION_GONE");
  }

  const now = Date.now();
  const hasLive = new Set<string>();
  for (const s of selections) {
    const event = s.market.event;
    if (s.status !== "ACTIVE" || s.market.status !== "OPEN") {
      throw new ApiError(`"${s.name}" in ${s.market.name} is currently suspended`, 409, "SELECTION_SUSPENDED");
    }
    if (event.status === "FINISHED" || event.status === "POSTPONED" || event.status === "CANCELLED") {
      throw new ApiError(`${event.homeTeam.name} vs ${event.awayTeam.name} is no longer open for betting`, 409, "EVENT_CLOSED");
    }
    if (event.status === "LIVE" || (event.startTime.getTime() <= now && event.status === "SCHEDULED")) {
      hasLive.add(event.id);
    }
  }
  // no two selections from the same market in accumulators/systems
  if (type !== "SINGLE") {
    const marketIds = selections.map((s) => s.market.id);
    if (new Set(marketIds).size !== marketIds.length) {
      throw new ApiError("Cannot combine two selections from the same market", 422, "SAME_MARKET");
    }
  }

  const legOdds = selections.map((s) => s.odds);
  const isLive = hasLive.size > 0;
  const totalOdds =
    type === "SINGLE" ? roundOdds(legOdds[0]) : productOdds(legOdds);
  const pwRaw =
    type === "SYSTEM" ? Math.floor(stakePerCombo * productOdds(legOdds)) : calcPotentialWin(totalStakeCents, totalOdds);
  const potentialWinCents = Math.min(pwRaw, settings.maxPotentialWinCents);

  // ---- suspicious betting pattern check (fraud) ----
  const recent = await db.bet.aggregate({
    where: { userId: user.id, createdAt: { gte: new Date(now - 30 * 86_400_000) } },
    _avg: { stakeCents: true },
  });
  const avgStake = recent._avg.stakeCents ?? 0;
  const suspicious = avgStake > 0 && totalStakeCents > avgStake * 10 && totalStakeCents > 50_000;

  // ---- atomic: create bet + debit wallet ----
  const bet = await db.$transaction(
    async (tx) => {
      // The bet row is created first so the stake debit can reference it in
      // the ledger (refId). If the debit throws INSUFFICIENT_FUNDS the whole
      // transaction — bet, legs and debit — rolls back atomically.
      const created = await tx.bet.create({
        data: {
          userId: user.id,
          type,
          systemK: type === "SYSTEM" ? systemK : null,
          stakeCents: totalStakeCents,
          stakePerComboCents: type === "SYSTEM" ? stakePerCombo : null,
          comboCount,
          totalOdds,
          potentialWinCents,
          status: isLive ? "PENDING_ACCEPTANCE" : "OPEN",
          liveAcceptAt: isLive ? new Date(now + settings.liveBetDelaySeconds * 1000) : null,
          placementIp: ip,
          metaJson: JSON.stringify({ acceptOddsChange: input.acceptOddsChange ?? false }),
          legs: {
            create: selections.map((s) => ({
              eventId: s.market.eventId,
              marketId: s.market.id,
              selectionId: s.id,
              eventName: `${s.market.event.homeTeam.name} vs ${s.market.event.awayTeam.name}`,
              marketName: s.market.name,
              marketKey: s.market.key,
              selectionName: s.name,
              oddsAtPlacement: s.odds,
              line: s.market.line,
            })),
          },
        },
        include: { legs: true },
      });

      await applyMutations(tx, [
        {
          userId: user.id,
          deltaCents: -totalStakeCents,
          entryType: "BET_STAKE",
          counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN,
          refType: "bet",
          refId: created.id,
          description: `${type.toLowerCase()} bet × ${selectionIds.length} selection${selectionIds.length > 1 ? "s" : ""}`,
        },
      ]);

      return created;
    },
    { timeout: 15_000 }
  );

  await notify(
    user.id,
    "BET_SETTLED",
    isLive ? "Live bet accepting" : "Bet placed",
    isLive
      ? `Your live bet is being confirmed (${settings.liveBetDelaySeconds}s delay).`
      : `Stake ${totalStakeCents / 100} ETB at odds ${totalOdds}.`
  );

  await logAudit({
    action: "BET_PLACED",
    entity: "bet",
    entityId: bet.id,
    ip,
    details: { userId: user.id, type, stakeCents: totalStakeCents, totalOdds, legs: selectionIds.length },
  });
  if (suspicious) {
    await logAudit({
      action: "FRAUD_FLAG",
      entity: "user",
      entityId: user.id,
      details: { reason: "unusual_stake", stakeCents: totalStakeCents, avgStakeCents: Math.round(avgStake) },
    });
  }

  return bet;
}

/**
 * Confirm or void live bets whose acceptance delay has elapsed.
 * Voided bets are refunded in full (odds moved / market suspended meanwhile).
 * Called by the worker every couple of seconds.
 */
export async function confirmPendingLiveBets(): Promise<Array<{ userId: string; kind: string; message: string }>> {
  const due = await db.bet.findMany({
    where: { status: "PENDING_ACCEPTANCE", liveAcceptAt: { lte: new Date() } },
    include: {
      legs: { include: { selection: { include: { market: true } } } },
    },
    take: 100,
  });

  const results: Array<{ userId: string; kind: string; message: string }> = [];
  for (const bet of due) {
    const okOdds = bet.legs.every(
      (leg) =>
        leg.selection.status === "ACTIVE" &&
        leg.selection.market.status === "OPEN" &&
        Math.abs(leg.selection.odds - leg.oddsAtPlacement) < 0.011
    );
    if (okOdds) {
      await db.bet.update({ where: { id: bet.id }, data: { status: "OPEN", liveAcceptAt: null } });
      results.push({ userId: bet.userId, kind: "bet_accepted", message: "Live bet confirmed" });
    } else {
      await voidAndRefundBet(bet.id, "Odds changed during live acceptance");
      results.push({ userId: bet.userId, kind: "bet_voided", message: "Live bet voided — odds moved. Stake refunded." });
    }
  }
  return results;
}

export async function voidAndRefundBet(betId: string, reason: string) {
  await db.$transaction(async (tx) => {
    const bet = await tx.bet.findUnique({ where: { id: betId } });
    if (!bet || (bet.status !== "OPEN" && bet.status !== "PENDING_ACCEPTANCE")) return;
    await applyMutations(tx, [
      {
        userId: bet.userId,
        deltaCents: bet.stakeCents,
        entryType: "BET_REFUND",
        counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN,
        refType: "bet",
        refId: bet.id,
        description: reason,
        txRow: { type: "REFUND", status: "SUCCESS", amountCents: bet.stakeCents, description: reason },
      },
    ]);
    await tx.bet.update({
      where: { id: betId },
      data: { status: "VOID", settledAt: new Date(), metaJson: JSON.stringify({ voidReason: reason }) },
    });
    await tx.betLeg.updateMany({ where: { betId }, data: { status: "VOID" } });
  });
  const bet = await db.bet.findUnique({ where: { id: betId } });
  if (bet) {
    await notify(bet.userId, "BET_SETTLED", "Bet voided", `${reason}. Your stake was refunded.`);
  }
}

/** Used by admin manual override. */
export async function adminForceSettleBet(
  admin: { id: string; phone: string },
  betId: string,
  outcome: "WON" | "LOST" | "VOID",
  payoutCents?: number
) {
  const bet = await db.bet.findUnique({ where: { id: betId } });
  if (!bet) throw new ApiError("Bet not found", 404, "NOT_FOUND");
  if (["WON", "LOST", "CASHED_OUT", "VOID"].includes(bet.status)) {
    throw new ApiError("Bet already settled", 400, "ALREADY_SETTLED");
  }
  if (outcome === "WON") {
    const payout = payoutCents ?? bet.potentialWinCents;
    await db.$transaction(async (tx) => {
      await applyMutations(tx, [
        {
          userId: bet.userId,
          deltaCents: payout,
          entryType: "BET_WIN",
          counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN,
          refType: "bet",
          refId: bet.id,
          description: "Manual settlement (admin)",
          txRow: { type: "WIN", status: "SUCCESS", amountCents: payout, description: "Manual settlement" },
        },
      ]);
      await tx.bet.update({ where: { id: betId }, data: { status: "WON", settledAt: new Date() } });
      await tx.betLeg.updateMany({ where: { betId }, data: { status: "WON" } });
    });
    await notify(bet.userId, "BET_SETTLED", "Bet won!", `${payout / 100} ETB credited to your wallet.`);
  } else if (outcome === "VOID") {
    await voidAndRefundBet(betId, "Voided by admin");
    await db.betLeg.updateMany({ where: { betId }, data: { status: "VOID" } });
  } else {
    await db.bet.update({ where: { id: betId }, data: { status: "LOST", settledAt: new Date() } });
    await db.betLeg.updateMany({ where: { betId }, data: { status: "LOST" } });
    await notify(bet.userId, "BET_SETTLED", "Bet lost", "Better luck next time!");
  }
  await logAudit({
    actorId: admin.id,
    actorPhone: admin.phone,
    action: "BET_MANUAL_SETTLE",
    entity: "bet",
    entityId: betId,
    details: { outcome, payoutCents: payoutCents ?? null },
  });
}

export const betWithLegsInclude = {
  legs: { include: { event: { select: { status: true, homeScore: true, awayScore: true } } } },
} satisfies Prisma.BetInclude;
