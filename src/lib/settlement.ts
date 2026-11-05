import "server-only";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { applyMutations, COUNTER_ACCOUNTS } from "@/lib/wallet";
import { notify } from "@/lib/audit";
import { productOdds } from "@/lib/money";
import { ConcurrencyError } from "@/lib/wallet";

/**
 * Settlement engine.
 *
 *  1. computeMarketOutcome: pure function market-key/line/score → winning
 *     selection name ("PUSH" for tie on integer lines → legs void).
 *  2. settleMarketsForEvent: marks every market of a finished event.
 *  3. settleBet: recomputes leg statuses (incl. VOID propagation and system
 *     combinations) and pays winners inside a single transaction.
 *  4. settleFinishedEvents: worker entry point — events → markets → bets,
 *     with notifications + socket payloads returned to the caller.
 *  5. Cashout: discounted offer based on remaining-leg odds progress.
 */

// ---------------------------------------------------------------------------
// Outcome computation (pure)
// ---------------------------------------------------------------------------

export function computeMarketOutcome(
  marketKey: string,
  line: number | null,
  homeScore: number,
  awayScore: number
): string | null | "PUSH" {
  if (marketKey === "1X2") {
    if (homeScore > awayScore) return "1";
    if (homeScore === awayScore) return "X";
    return "2";
  }
  if (marketKey.startsWith("DOUBLE_CHANCE_")) {
    const outcome =
      homeScore > awayScore ? "1" : homeScore === awayScore ? "X" : "2";
    const wanted = marketKey.replace("DOUBLE_CHANCE_", "").split(""); // e.g. ["1","X"]
    // Covered → the DC selection itself wins (e.g. "1X").
    // Not covered → return the raw outcome ("1"/"X"/"2"), which matches no DC
    // selection, so legs on this market are LOST. Voiding here would wrongly
    // refund genuine losses — voids are reserved for pushes/cancellations.
    return wanted.includes(outcome) ? marketKey.replace("DOUBLE_CHANCE_", "") : outcome;
  }
  if (marketKey.startsWith("OVER_UNDER_")) {
    const total = homeScore + awayScore;
    const l = line ?? 2.5;
    if (total === l) return "PUSH";
    return total > l ? "OVER" : "UNDER";
  }
  if (marketKey === "BTTS") {
    return homeScore > 0 && awayScore > 0 ? "YES" : "NO";
  }
  if (marketKey.startsWith("HANDICAP_")) {
    const l = line ?? -1;
    const homeAdj = homeScore + l;
    if (homeAdj === awayScore) return "PUSH";
    return homeAdj > awayScore ? "HOME" : "AWAY";
  }
  if (marketKey === "MONEY_LINE") {
    return homeScore > awayScore ? "HOME" : "AWAY";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Market settlement
// ---------------------------------------------------------------------------

export async function settleMarketsForEvent(eventId: string): Promise<boolean> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: { markets: { include: { selections: true } } },
  });
  if (!event) return false;
  if (event.status !== "FINISHED" && event.status !== "CANCELLED" && event.status !== "POSTPONED") return false;

  const voidAll = event.status !== "FINISHED";
  const home = event.homeScore ?? 0;
  const away = event.awayScore ?? 0;
  let changed = false;

  for (const market of event.markets) {
    if (market.status === "SETTLED") continue;
    let resultName: string | null = null;
    if (!voidAll && market.status === "OPEN" && market.selections.length > 0) {
      const outcome = computeMarketOutcome(market.key, market.line, home, away);
      if (outcome === "PUSH") {
        // integer-line tie → market resolves with no winner (legs void)
        resultName = null;
      } else {
        resultName = outcome;
      }
    }
    await db.market.update({
      where: { id: market.id },
      data: { status: "SETTLED", resultName, settledAt: new Date(), suspendedAt: null },
    });
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Bet settlement
// ---------------------------------------------------------------------------

export interface SettlementResult {
  betId: string;
  userId: string;
  status: "WON" | "LOST" | "VOID" | "OPEN" | "CASHED_OUT";
  payoutCents: number;
}

/**
 * Settle a single bet: refresh leg statuses from market results, then pay.
 * Handles SINGLE, MULTIPLE and SYSTEM (k-combinations with void handling).
 */
export async function settleBet(betId: string): Promise<SettlementResult | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const bet = await tx.bet.findUnique({
          where: { id: betId },
          include: {
            legs: {
              include: { market: { select: { status: true, resultName: true } } },
            },
          },
        });
        if (!bet) return null;
        if (!["OPEN", "PENDING_ACCEPTANCE"].includes(bet.status)) {
          return {
            betId: bet.id,
            userId: bet.userId,
            status: bet.status as SettlementResult["status"],
            payoutCents: 0,
          };
        }

        // refresh leg statuses
        const legStatuses: Array<"WON" | "LOST" | "VOID" | "OPEN"> = [];
        let anyChanged = false;
        for (const leg of bet.legs) {
          let next: "WON" | "LOST" | "VOID" | "OPEN" = "OPEN";
          if (leg.market.status === "SETTLED") {
            const resultName = leg.market.resultName;
            if (!resultName) next = "VOID";
            else next = resultName === leg.selectionName ? "WON" : "LOST";
          }
          if (leg.status !== next) {
            anyChanged = true;
            await tx.betLeg.update({ where: { id: leg.id }, data: { status: next, settledAt: next === "OPEN" ? null : new Date() } });
          }
          legStatuses.push(next);
        }

        const allSettled = legStatuses.every((s) => s !== "OPEN");
        if (!allSettled) {
          return { betId: bet.id, userId: bet.userId, status: "OPEN" as const, payoutCents: 0 };
        }

        // ----- payout computation -----
        let payoutCents = 0;
        let finalStatus: "WON" | "LOST" | "VOID";

        if (bet.type === "SYSTEM" && bet.systemK && bet.stakePerComboCents) {
          const legs = bet.legs.map((leg, i) => ({ odds: leg.oddsAtPlacement, status: legStatuses[i] }));
          const comboCount = bet.comboCount || 1;
          // enumerate all k-combinations of leg indexes
          const combos = kCombos(legs.length, bet.systemK);
          let total = 0;
          for (const combo of combos) {
            const legsInCombo = combo.map((idx) => legs[idx]);
            if (legsInCombo.some((l) => l.status === "LOST")) continue; // combo lost
            const active = legsInCombo.filter((l) => l.status === "WON");
            const voided = legsInCombo.filter((l) => l.status === "VOID");
            if (voided.length === legsInCombo.length) {
              // fully void combo → stake returned
              total += bet.stakePerComboCents;
            } else if (active.length === legsInCombo.length - voided.length && active.length > 0) {
              total += Math.floor(bet.stakePerComboCents * productOdds(active.map((l) => l.odds)));
            } else {
              // mixed void/won without full coverage: stake * product(active odds)
              total += Math.floor(bestPartialRefund(bet.stakePerComboCents, active.map((l) => l.odds)));
            }
          }
          payoutCents = total;
          // system bets: any positive return counts as WON (may be partial)
          finalStatus = payoutCents > 0 ? "WON" : "LOST";
        } else {
          // SINGLE / MULTIPLE: void legs drop out of the product; a lost leg kills it
          if (legStatuses.includes("LOST")) {
            payoutCents = 0;
            finalStatus = "LOST";
          } else {
            const active = bet.legs.filter((_, i) => legStatuses[i] === "WON");
            const voidedCount = legStatuses.filter((s) => s === "VOID").length;
            if (voidedCount === legStatuses.length) {
              payoutCents = bet.stakeCents;
              finalStatus = "VOID";
            } else {
              const effectiveOdds = productOdds(active.map((l) => l.oddsAtPlacement));
              payoutCents = Math.floor(bet.stakeCents * effectiveOdds);
              finalStatus = payoutCents > 0 ? "WON" : "VOID";
            }
          }
        }

        // write payout
        if (payoutCents > 0) {
          await applyMutations(tx, [
            {
              userId: bet.userId,
              deltaCents: payoutCents,
              entryType: finalStatus === "VOID" ? "BET_REFUND" : "BET_WIN",
              counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN,
              refType: "bet",
              refId: bet.id,
              description:
                finalStatus === "VOID"
                  ? "Bet voided — stake refunded"
                  : `Bet won (${bet.type.toLowerCase()})`,
              txRow: {
                type: finalStatus === "VOID" ? "REFUND" : "WIN",
                status: "SUCCESS",
                amountCents: payoutCents,
                description: finalStatus === "VOID" ? "Void refund" : "Bet winnings",
              },
            },
          ]);
        }

        await tx.bet.update({
          where: { id: bet.id },
          data: { status: finalStatus, settledAt: new Date(), cashoutOfferCents: null },
        });

        return { betId: bet.id, userId: bet.userId, status: finalStatus, payoutCents };
      }, { timeout: 15_000 });
    } catch (err) {
      if (err instanceof ConcurrencyError && attempt < 3) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  return null;
}

function bestPartialRefund(stake: number, odds: number[]): number {
  return odds.length > 0 ? stake * productOdds(odds) : stake;
}

function kCombos(n: number, k: number): number[][] {
  const result: number[][] = [];
  const current: number[] = [];
  const walk = (start: number) => {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < n; i++) {
      current.push(i);
      walk(i + 1);
      current.pop();
    }
  };
  walk(0);
  return result;
}

// ---------------------------------------------------------------------------
// Worker entry: settle every finished-but-unsettled event, then its bets
// ---------------------------------------------------------------------------

export async function settleFinishedEvents(
  limit = 10
): Promise<Array<{ userId: string; kind: string; message: string }>> {
  const events = await db.event.findMany({
    where: { status: { in: ["FINISHED", "CANCELLED", "POSTPONED"] }, settledAt: null },
    orderBy: { startTime: "desc" },
    take: limit,
  });

  const notifications: Array<{ userId: string; kind: string; message: string }> = [];

  for (const event of events) {
    const marketChanged = await settleMarketsForEvent(event.id);
    const bets = await db.bet.findMany({
      where: {
        status: { in: ["OPEN", "PENDING_ACCEPTANCE"] },
        legs: { some: { eventId: event.id } },
      },
      select: { id: true },
      take: 200,
    });
    for (const { id } of bets) {
      const result = await settleBet(id);
      if (!result || result.status === "OPEN") continue;
      if (result.status === "WON") {
        notifications.push({
          userId: result.userId,
          kind: "bet_won",
          message: `Bet won! ${result.payoutCents / 100} ETB credited.`,
        });
        await notify(result.userId, "BET_SETTLED", "Bet won!", `${result.payoutCents / 100} ETB credited to your wallet.`);
      } else if (result.status === "LOST") {
        notifications.push({ userId: result.userId, kind: "bet_lost", message: "Bet lost" });
        await notify(result.userId, "BET_SETTLED", "Bet lost", "Better luck next time!");
      } else {
        notifications.push({
          userId: result.userId,
          kind: "bet_voided",
          message: `Bet voided — ${result.payoutCents / 100} ETB refunded.`,
        });
        await notify(result.userId, "BET_SETTLED", "Bet voided", `Stake refunded (${result.payoutCents / 100} ETB).`);
      }
    }
    await db.event.update({
      where: { id: event.id },
      data: {
        settledAt: new Date(),
        resultJson: JSON.stringify({ marketChanges: marketChanged, betsSettled: bets.length }),
      },
    });
  }
  return notifications;
}

// ---------------------------------------------------------------------------
// Cashout
// ---------------------------------------------------------------------------

export interface CashoutContext {
  betId: string;
  userId: string;
  offerCents: number;
}

/** Compute the current cashout offer for an OPEN bet (null if unavailable). */
export async function getCashoutOffer(betId: string, userId: string): Promise<CashoutContext | null> {
  const settings = await getSettings();
  const bet = await db.bet.findFirst({
    where: { id: betId, userId },
    include: {
      legs: {
        include: { selection: true },
      },
    },
  });
  if (!bet || bet.status !== "OPEN" || bet.legs.length === 0) return null;

  // every leg's event must still be running or upcoming (no settled legs)
  const openLegs = bet.legs.filter((l) => l.status === "OPEN");
  if (openLegs.length !== bet.legs.length) {
    // partial cashout of accumulators with settled legs: settled WON legs count as 1.0
    if (!bet.legs.every((l) => l.status === "OPEN" || l.status === "WON")) return null;
  }

  const currentOdds: number[] = [];
  for (const leg of openLegs) {
    const sel = leg.selection;
    if (!sel || sel.status !== "ACTIVE") return null; // suspended selection blocks cashout
    currentOdds.push(leg.selection.odds);
  }
  const settledLegs = bet.legs.filter((l) => l.status === "WON").length;

  const remainingOdds = productOdds(currentOdds);
  const progress = remainingOdds / Math.max(1.01, bet.totalOdds);
  let offer = Math.floor(bet.potentialWinCents * progress * settings.cashoutDiscount);
  offer = Math.min(offer, bet.potentialWinCents - 1);
  offer = Math.max(offer, Math.floor(bet.stakeCents * 0.05));
  if (settledLegs === bet.legs.length || offer < 100) return null; // 1 ETB minimum offer

  return { betId, userId, offerCents: offer };
}

/** Accept a cashout: pay the offer, close the bet. */
export async function cashoutBet(betId: string, userId: string): Promise<{ offerCents: number }> {
  const offer = await getCashoutOffer(betId, userId);
  if (!offer) throw new Error("Cashout not available");

  await db.$transaction(async (tx) => {
    const updated = await tx.bet.updateMany({
      where: { id: betId, userId, status: "OPEN" }, // claim-style guard: only first caller wins
      data: { status: "CASHED_OUT", settledAt: new Date(), cashoutOfferCents: offer.offerCents },
    });
    if (updated.count === 0) throw new Error("Cashout not available");
    await applyMutations(tx, [
      {
        userId,
        deltaCents: offer.offerCents,
        entryType: "CASHOUT",
        counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN,
        refType: "bet",
        refId: betId,
        description: "Cashout",
        txRow: { type: "CASHOUT", status: "SUCCESS", amountCents: offer.offerCents, description: "Bet cashout" },
      },
    ]);
  }, { timeout: 15_000 });

  await notify(userId, "BET_SETTLED", "Cashout successful", `${offer.offerCents / 100} ETB credited to your wallet.`);
  return { offerCents: offer.offerCents };
}
