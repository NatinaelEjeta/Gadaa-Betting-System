import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  computeMarketOutcome,
  settleMarketsForEvent,
  settleBet,
  settleFinishedEvents,
  getCashoutOffer,
  cashoutBet,
} from "@/lib/settlement";
import { placeBet } from "@/lib/bets";
import {
  makeUser,
  resetDb,
  balanceOf,
  ledgerOf,
  makeEvent,
  makeStandardEvent,
  sel,
  finishEvent,
  type EventWithMarkets,
} from "../helpers/world";

/**
 * Settlement engine coverage:
 *   - computeMarketOutcome (pure): 1X2, Double Chance, Over/Under (+ push),
 *     BTTS, Handicap (+ push), Money Line
 *   - market settlement for finished/postponed/cancelled events
 *   - bet settlement: singles, accumulators (lost/void/all-void legs),
 *     system bets (won/lost/void combos), partial settlement, idempotency
 *   - worker entry (settleFinishedEvents) and cashout
 */

const USER = (id: string, phone: string) => ({ id, phone });
const STAKE = 500;

beforeEach(resetDb);

// ---------------------------------------------------------------------------
// Pure outcome computation
// ---------------------------------------------------------------------------

describe("computeMarketOutcome (pure)", () => {
  it("1X2 maps the score to 1 / X / 2", () => {
    expect(computeMarketOutcome("1X2", null, 2, 1)).toBe("1");
    expect(computeMarketOutcome("1X2", null, 1, 1)).toBe("X");
    expect(computeMarketOutcome("1X2", null, 0, 3)).toBe("2");
  });

  it("Double Chance covers both named outcomes and nothing else", () => {
    expect(computeMarketOutcome("DOUBLE_CHANCE_1X", null, 2, 0)).toBe("1X"); // home win
    expect(computeMarketOutcome("DOUBLE_CHANCE_1X", null, 1, 1)).toBe("1X"); // draw
    // not covered → the raw outcome is returned so legs LOST (never voided)
    expect(computeMarketOutcome("DOUBLE_CHANCE_1X", null, 0, 1)).toBe("2"); // away win
    expect(computeMarketOutcome("DOUBLE_CHANCE_12", null, 2, 1)).toBe("12");
    expect(computeMarketOutcome("DOUBLE_CHANCE_12", null, 1, 1)).toBe("X");
    expect(computeMarketOutcome("DOUBLE_CHANCE_12", null, 0, 1)).toBe("12");
    expect(computeMarketOutcome("DOUBLE_CHANCE_X2", null, 2, 0)).toBe("1");
    expect(computeMarketOutcome("DOUBLE_CHANCE_X2", null, 1, 1)).toBe("X2");
    expect(computeMarketOutcome("DOUBLE_CHANCE_X2", null, 0, 2)).toBe("X2");
  });

  it("Over/Under resolves by total goals", () => {
    expect(computeMarketOutcome("OVER_UNDER_2_5", 2.5, 2, 1)).toBe("OVER"); // 3 > 2.5
    expect(computeMarketOutcome("OVER_UNDER_2_5", 2.5, 1, 0)).toBe("UNDER"); // 1 < 2.5
    expect(computeMarketOutcome("OVER_UNDER_2_5", 2.5, 1, 1)).toBe("UNDER"); // 2 < 2.5 (no push on .5 lines)
  });

  it("Over/Under pushes when the total equals an integer line", () => {
    expect(computeMarketOutcome("OVER_UNDER_2_0", 2.0, 1, 1)).toBe("PUSH");
    expect(computeMarketOutcome("OVER_UNDER_2_0", 2.0, 2, 0)).toBe("PUSH");
    expect(computeMarketOutcome("OVER_UNDER_2_0", 2.0, 2, 1)).toBe("OVER");
    expect(computeMarketOutcome("OVER_UNDER_2_0", 2.0, 0, 1)).toBe("UNDER");
    expect(computeMarketOutcome("OVER_UNDER_3_0", 3.0, 2, 1)).toBe("PUSH");
  });

  it("BTTS needs both teams on the scoresheet", () => {
    expect(computeMarketOutcome("BTTS", null, 1, 1)).toBe("YES");
    expect(computeMarketOutcome("BTTS", null, 2, 1)).toBe("YES");
    expect(computeMarketOutcome("BTTS", null, 2, 0)).toBe("NO");
    expect(computeMarketOutcome("BTTS", null, 0, 0)).toBe("NO");
  });

  it("Handicap adjusts the home score by the line; level adjusted score pushes", () => {
    expect(computeMarketOutcome("HANDICAP_-1", -1, 2, 0)).toBe("HOME"); // 2-1=1 > 0
    expect(computeMarketOutcome("HANDICAP_-1", -1, 1, 0)).toBe("PUSH"); // 1-1=0 = 0
    expect(computeMarketOutcome("HANDICAP_-1", -1, 2, 2)).toBe("AWAY"); // 2-1=1 < 2
    expect(computeMarketOutcome("HANDICAP_-1", -1, 0, 1)).toBe("AWAY");
    expect(computeMarketOutcome("HANDICAP_1", 1, 0, 1)).toBe("PUSH"); // 0+1=1 = 1
    expect(computeMarketOutcome("HANDICAP_1", 1, 0, 2)).toBe("AWAY");
    expect(computeMarketOutcome("HANDICAP_1", 1, 1, 0)).toBe("HOME");
  });

  it("Money Line and unknown keys", () => {
    expect(computeMarketOutcome("MONEY_LINE", null, 2, 1)).toBe("HOME");
    expect(computeMarketOutcome("MONEY_LINE", null, 1, 2)).toBe("AWAY");
    expect(computeMarketOutcome("CORNER_RACE", null, 1, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Singles across every market type
// ---------------------------------------------------------------------------

describe("single bet settlement by market", () => {
  async function singleOn(event: EventWithMarkets, marketKey: string, selectionName: string) {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, marketKey, selectionName).id],
    });
    return { user, bet };
  }

  it("1X2 — home win pays the winner, away pick loses", async () => {
    const event = await makeStandardEvent();
    const { user, bet: winner } = await singleOn(event, "1X2", "1");
    const { user: loser, bet: lost } = await singleOn(event, "1X2", "2");

    await finishEvent(event.id, 2, 1);
    expect(await settleBet(winner.id)).toMatchObject({ status: "WON", payoutCents: 1_000 });
    expect(await settleBet(lost.id)).toMatchObject({ status: "LOST", payoutCents: 0 });

    expect((await balanceOf(user.id)).balanceCents).toBe(10_000 - 500 + 1_000);
    expect((await balanceOf(loser.id)).balanceCents).toBe(9_500); // stake gone, nothing back
  });

  it("1X2 — draw pays X", async () => {
    const event = await makeStandardEvent();
    const { user, bet } = await singleOn(event, "1X2", "X");
    await finishEvent(event.id, 1, 1);
    expect(await settleBet(bet.id)).toMatchObject({ status: "WON", payoutCents: 1_600 }); // 500 × 3.2
    expect((await balanceOf(user.id)).balanceCents).toBe(11_100);
  });

  it("Over 2.5 / Under 2.5", async () => {
    const event = await makeStandardEvent();
    const { user: over, bet: overBet } = await singleOn(event, "OVER_UNDER_2_5", "OVER");
    const { user: under, bet: underBet } = await singleOn(event, "OVER_UNDER_2_5", "UNDER");

    await finishEvent(event.id, 2, 1); // 3 goals
    expect(await settleBet(overBet.id)).toMatchObject({ status: "WON", payoutCents: 950 }); // 500 × 1.9
    expect(await settleBet(underBet.id)).toMatchObject({ status: "LOST", payoutCents: 0 });
    expect((await balanceOf(over.id)).balanceCents).toBe(10_450);
    expect((await balanceOf(under.id)).balanceCents).toBe(9_500);
  });

  it("Over/Under integer line — total equals the line pushes the market and voids the bet", async () => {
    const event = await makeStandardEvent();
    const { user, bet } = await singleOn(event, "OVER_UNDER_2_0", "UNDER");

    await finishEvent(event.id, 1, 1); // total 2 == line 2.0 → PUSH
    expect(await settleBet(bet.id)).toMatchObject({ status: "VOID", payoutCents: 500 });

    expect((await balanceOf(user.id)).balanceCents).toBe(10_000); // full stake back
    const refund = (await ledgerOf(user.id)).find((e) => e.entryType === "BET_REFUND");
    expect(refund).toBeDefined();
    const market = await db.market.findUniqueOrThrow({ where: { id: sel(event, "OVER_UNDER_2_0", "UNDER").marketId } });
    expect(market.status).toBe("SETTLED");
    expect(market.resultName).toBeNull(); // no winning selection — everyone voids
  });

  it("BTTS — YES wins when both score, NO wins otherwise", async () => {
    const goals = await makeStandardEvent();
    const clean = await makeStandardEvent();
    const { user: yes, bet: yesBet } = await singleOn(goals, "BTTS", "YES");
    const { user: no, bet: noBet } = await singleOn(clean, "BTTS", "NO");

    await finishEvent(goals.id, 1, 1);
    await finishEvent(clean.id, 2, 0);
    expect(await settleBet(yesBet.id)).toMatchObject({ status: "WON", payoutCents: 900 });
    expect(await settleBet(noBet.id)).toMatchObject({ status: "WON", payoutCents: 1_000 });
    expect((await balanceOf(yes.id)).balanceCents).toBe(10_400);
    expect((await balanceOf(no.id)).balanceCents).toBe(10_500);
  });

  it("Double Chance — 1X survives home win and draw", async () => {
    const homeWin = await makeStandardEvent();
    const draw = await makeStandardEvent();
    const { user: a, bet: aBet } = await singleOn(homeWin, "DOUBLE_CHANCE_1X", "1X");
    const { user: b, bet: bBet } = await singleOn(draw, "DOUBLE_CHANCE_1X", "1X");

    await finishEvent(homeWin.id, 2, 0);
    await finishEvent(draw.id, 1, 1);
    expect(await settleBet(aBet.id)).toMatchObject({ status: "WON", payoutCents: 725 }); // 500 × 1.45
    expect(await settleBet(bBet.id)).toMatchObject({ status: "WON", payoutCents: 725 });
    expect((await balanceOf(a.id)).balanceCents).toBe(10_225);
    expect((await balanceOf(b.id)).balanceCents).toBe(10_225);
  });

  it("Double Chance — 12 and X2 pick their halves of the result space", async () => {
    const awayWin = await makeStandardEvent();
    const homeWin = await makeStandardEvent();
    const { user: a, bet: aBet } = await singleOn(awayWin, "DOUBLE_CHANCE_12", "12");
    const { user: b, bet: bBet } = await singleOn(homeWin, "DOUBLE_CHANCE_X2", "X2");

    await finishEvent(awayWin.id, 0, 1);
    await finishEvent(homeWin.id, 2, 0);
    expect(await settleBet(aBet.id)).toMatchObject({ status: "WON", payoutCents: 650 }); // 500 × 1.3
    // X2 missed the home win — a genuine LOSS, not a void/refund
    expect(await settleBet(bBet.id)).toMatchObject({ status: "LOST", payoutCents: 0 });
    expect((await balanceOf(b.id)).balanceCents).toBe(9_500);
  });

  it("Handicap -1 — HOME wins by two, pushes by one, AWAY wins otherwise", async () => {
    const byTwo = await makeStandardEvent();
    const byOne = await makeStandardEvent();
    const level = await makeStandardEvent();
    const { user: home, bet: homeBet } = await singleOn(byTwo, "HANDICAP_-1", "HOME");
    const { user: push, bet: pushBet } = await singleOn(byOne, "HANDICAP_-1", "HOME");
    const { user: away, bet: awayBet } = await singleOn(level, "HANDICAP_-1", "AWAY");

    await finishEvent(byTwo.id, 2, 0);
    await finishEvent(byOne.id, 1, 0);
    await finishEvent(level.id, 2, 2);

    expect(await settleBet(homeBet.id)).toMatchObject({ status: "WON", payoutCents: 1_300 }); // 500 × 2.6
    expect(await settleBet(pushBet.id)).toMatchObject({ status: "VOID", payoutCents: 500 });
    expect(await settleBet(awayBet.id)).toMatchObject({ status: "WON", payoutCents: 750 }); // 500 × 1.5
    expect((await balanceOf(home.id)).balanceCents).toBe(10_800);
    expect((await balanceOf(push.id)).balanceCents).toBe(10_000);
    expect((await balanceOf(away.id)).balanceCents).toBe(10_250);
  });
});

// ---------------------------------------------------------------------------
// Accumulators
// ---------------------------------------------------------------------------

describe("accumulator settlement", () => {
  it("all legs won — payout at the combined odds", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "MULTIPLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id, sel(event, "BTTS", "YES").id],
    });

    await finishEvent(event.id, 2, 1);
    expect(await settleBet(bet.id)).toMatchObject({ status: "WON", payoutCents: 1_800 }); // 500 × 3.6
    expect((await balanceOf(user.id)).balanceCents).toBe(11_300);
  });

  it("one leg lost kills the whole accumulator", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "MULTIPLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id, sel(event, "BTTS", "NO").id],
    });

    await finishEvent(event.id, 2, 1); // "1" won, BTTS NO lost
    expect(await settleBet(bet.id)).toMatchObject({ status: "LOST", payoutCents: 0 });
    expect((await balanceOf(user.id)).balanceCents).toBe(9_500);
  });

  it("a void leg drops out of the odds product — remaining legs still pay", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "MULTIPLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id, sel(event, "OVER_UNDER_2_0", "UNDER").id], // 2.0 × 2.05
    });

    await finishEvent(event.id, 2, 0); // "1" won; total 2 on line 2.0 → PUSH → void
    const result = await settleBet(bet.id);
    expect(result).toMatchObject({ status: "WON", payoutCents: 1_000 }); // 500 × 2.0 only
    expect((await balanceOf(user.id)).balanceCents).toBe(10_500);

    const legs = await db.betLeg.findMany({ where: { betId: bet.id } });
    expect(legs.map((l) => l.status).sort()).toEqual(["VOID", "WON"]);
  });

  it("all legs void — full stake refund and VOID status", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const eventA = await makeStandardEvent(); // O/U 2.0, finish 1-1 → push
    const eventB = await makeStandardEvent(); // Handicap -1, finish 1-0 → push
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "MULTIPLE",
      stakeCents: STAKE,
      selectionIds: [sel(eventA, "OVER_UNDER_2_0", "UNDER").id, sel(eventB, "HANDICAP_-1", "HOME").id],
    });

    await finishEvent(eventA.id, 1, 1);
    await finishEvent(eventB.id, 1, 0);
    expect(await settleBet(bet.id)).toMatchObject({ status: "VOID", payoutCents: 500 });
    expect((await balanceOf(user.id)).balanceCents).toBe(10_000);
  });

  it("stays OPEN while any leg's market is still unsettled (cross-event accumulator)", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event1 = await makeStandardEvent();
    const event2 = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "MULTIPLE",
      stakeCents: STAKE,
      selectionIds: [sel(event1, "1X2", "1").id, sel(event2, "BTTS", "YES").id],
    });

    await finishEvent(event1.id, 2, 1); // only leg 1 decided so far
    expect(await settleBet(bet.id)).toMatchObject({ status: "OPEN", payoutCents: 0 });
    expect((await db.bet.findUniqueOrThrow({ where: { id: bet.id } })).status).toBe("OPEN");
    expect((await balanceOf(user.id)).balanceCents).toBe(9_500); // no money moved yet

    await finishEvent(event2.id, 1, 1); // now everything is decided
    expect(await settleBet(bet.id)).toMatchObject({ status: "WON", payoutCents: 1_800 });
    expect((await balanceOf(user.id)).balanceCents).toBe(11_300);
  });
});

// ---------------------------------------------------------------------------
// System bets (k-of-n combinations)
// ---------------------------------------------------------------------------

describe("system bet settlement", () => {
  /** 2/3 system: legs 1X2 "1" @2.0, BTTS YES @1.8, O/U 2.5 OVER @1.9 → stake 500/combo, 1500 total. */
  async function system23() {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SYSTEM",
      systemK: 2,
      stakeCents: STAKE,
      selectionIds: [
        sel(event, "1X2", "1").id,
        sel(event, "BTTS", "YES").id,
        sel(event, "OVER_UNDER_2_5", "OVER").id,
      ],
    });
    return { user, event, bet };
  }

  it("all legs won — every combination pays", async () => {
    const { user, event, bet } = await system23();
    await finishEvent(event.id, 2, 1); // home win, BTTS yes, 3 goals → all WON

    // combos: (1X2,BTTS)=500×3.6=1800, (1X2,OVER)=500×3.8=1900, (BTTS,OVER)=500×3.42=1710
    expect(await settleBet(bet.id)).toMatchObject({ status: "WON", payoutCents: 5_410 });
    expect((await balanceOf(user.id)).balanceCents).toBe(10_000 - 1_500 + 5_410);
  });

  it("one leg lost — only combinations avoiding it pay", async () => {
    const { user, event, bet } = await system23();
    await finishEvent(event.id, 1, 2); // away win → 1X2 "1" LOST; BTTS YES + OVER still won

    expect(await settleBet(bet.id)).toMatchObject({ status: "WON", payoutCents: 1_710 }); // (BTTS,OVER) only
    expect((await balanceOf(user.id)).balanceCents).toBe(10_210); // 10,000 − 1500 + 1710 → still net +210
  });

  it("a void leg — combinations re-price without it, full combos still pay", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const voidEvent = await makeStandardEvent(); // O/U 2.0 UNDER, 1-1 → push
    const winEvent = await makeStandardEvent(); // BTTS YES, 1-1 → won
    const winEvent2 = await makeStandardEvent(); // 1X2 "1", 2-1 → won
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SYSTEM",
      systemK: 2,
      stakeCents: STAKE,
      selectionIds: [
        sel(voidEvent, "OVER_UNDER_2_0", "UNDER").id, // @2.05 → void
        sel(winEvent, "BTTS", "YES").id, // @1.8
        sel(winEvent2, "1X2", "1").id, // @2.0
      ],
    });

    await finishEvent(voidEvent.id, 1, 1);
    await finishEvent(winEvent.id, 1, 1);
    await finishEvent(winEvent2.id, 2, 1);

    // (void,BTTS) → 500×1.8=900; (void,1X2) → 500×2.0=1000; (BTTS,1X2) → 500×3.6=1800
    expect(await settleBet(bet.id)).toMatchObject({ status: "WON", payoutCents: 3_700 });
    expect((await balanceOf(user.id)).balanceCents).toBe(12_200);
  });

  it("all legs void — every combination refunds its stake (full outlay returned)", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const pushA = await makeStandardEvent(); // O/U 2.0 UNDER, 1-1 → push
    const pushB = await makeStandardEvent(); // Handicap -1 HOME, 1-0 → push
    const pushC = await makeEvent({
      status: "SCHEDULED",
      startTime: new Date(Date.now() + 3_600_000),
      markets: [{ key: "HANDICAP_1", name: "Handicap +1", line: 1, selections: { HOME: 1.6, AWAY: 2.3 } }],
    }); // finish 0-1 → 0+1 == 1 → push
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SYSTEM",
      systemK: 2,
      stakeCents: STAKE,
      selectionIds: [
        sel(pushA, "OVER_UNDER_2_0", "UNDER").id,
        sel(pushB, "HANDICAP_-1", "HOME").id,
        sel(pushC, "HANDICAP_1", "AWAY").id,
      ],
    });

    await finishEvent(pushA.id, 1, 1);
    await finishEvent(pushB.id, 1, 0);
    await finishEvent(pushC.id, 0, 1);

    // System bets treat any positive return as WON — here every combo returns
    // its own stake, so the full 1500 outlay comes back.
    expect(await settleBet(bet.id)).toMatchObject({ status: "WON", payoutCents: 1_500 });
    expect((await balanceOf(user.id)).balanceCents).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// Idempotency, worker entry, cancelled events
// ---------------------------------------------------------------------------

describe("settlement idempotency & worker", () => {
  it("settleBet pays exactly once — a second call is a no-op", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id],
    });
    await finishEvent(event.id, 2, 1);

    expect(await settleBet(bet.id)).toMatchObject({ status: "WON", payoutCents: 1_000 });
    const afterFirst = (await balanceOf(user.id)).balanceCents;

    const second = await settleBet(bet.id);
    expect(second).toMatchObject({ status: "WON", payoutCents: 0 }); // already settled: no payout again

    expect((await balanceOf(user.id)).balanceCents).toBe(afterFirst);
    expect((await ledgerOf(user.id)).filter((e) => e.entryType === "BET_WIN")).toHaveLength(1);
  });

  it("settleFinishedEvents settles markets + bets and is safe to re-run", async () => {
    const winner = await makeUser({ initialBalanceCents: 10_000 });
    const loser = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const winBet = await placeBet(USER(winner.id, winner.phone), {
      type: "SINGLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id],
    });
    const lostBet = await placeBet(USER(loser.id, loser.phone), {
      type: "SINGLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "2").id],
    });
    await db.event.update({ where: { id: event.id }, data: { status: "FINISHED", homeScore: 2, awayScore: 1 } });

    const notificationsBefore = await db.notification.count(); // placement notices only
    const notifications = await settleFinishedEvents();
    expect(notifications.map((n) => n.kind).sort()).toEqual(["bet_lost", "bet_won"]);
    expect((await balanceOf(winner.id)).balanceCents).toBe(10_500);
    expect((await balanceOf(loser.id)).balanceCents).toBe(9_500);
    expect((await db.bet.findUniqueOrThrow({ where: { id: winBet.id } })).settledAt).not.toBeNull();
    expect((await db.event.findUniqueOrThrow({ where: { id: event.id } })).settledAt).not.toBeNull();

    // re-run: event already marked settled → nothing re-settles, nobody re-pays
    await settleFinishedEvents();
    expect((await balanceOf(winner.id)).balanceCents).toBe(10_500);
    expect((await balanceOf(loser.id)).balanceCents).toBe(9_500);
    expect(await db.notification.count()).toBe(notificationsBefore + 2);
  });

  it("cancelled events void every bet and refund the stakes", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id],
    });
    await db.event.update({ where: { id: event.id }, data: { status: "CANCELLED" } });

    await settleFinishedEvents();

    const markets = await db.market.findMany({ where: { eventId: event.id } });
    expect(markets.every((m) => m.status === "SETTLED" && m.resultName === null)).toBe(true);
    expect((await balanceOf(user.id)).balanceCents).toBe(10_000);
  });

  it("ignores events that are not finished/cancelled/postponed", async () => {
    const event = await makeStandardEvent(); // SCHEDULED
    const changed = await settleMarketsForEvent(event.id);
    expect(changed).toBe(false);
    const markets = await db.market.findMany({ where: { eventId: event.id } });
    expect(markets.every((m) => m.status === "OPEN")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cashout
// ---------------------------------------------------------------------------

describe("cashout", () => {
  const DISCOUNT = 0.85; // settings.cashoutDiscount default

  it("offers a discounted share of the potential win for a running single", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id], // @2.0 → potentialWin 1000
    });

    // progress = 2.0 / 2.0 = 1 → offer = floor(1000 × 1 × 0.85) = 850
    const offer = await getCashoutOffer(bet.id, user.id);
    expect(offer).toMatchObject({ betId: bet.id, userId: user.id, offerCents: 850 });
  });

  it("executes the cashout: credits the offer and closes the bet exactly once", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id],
    });

    const { offerCents } = await cashoutBet(bet.id, user.id);
    expect(offerCents).toBe(850);
    expect((await balanceOf(user.id)).balanceCents).toBe(9_500 + 850);
    expect(await db.bet.findUniqueOrThrow({ where: { id: bet.id } })).toMatchObject({
      status: "CASHED_OUT",
      cashoutOfferCents: 850,
    });
    expect((await ledgerOf(user.id)).find((e) => e.entryType === "CASHOUT")).toMatchObject({ amountCents: 850 });

    // a second attempt cannot double-pay (claim-style status guard)
    await expect(cashoutBet(bet.id, user.id)).rejects.toThrow(/Cashout not available/i);
    expect((await balanceOf(user.id)).balanceCents).toBe(10_350);
  });

  it("is unavailable when a selection is suspended", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id],
    });
    await db.selection.update({ where: { id: bet.legs[0].selectionId }, data: { status: "SUSPENDED" } });

    expect(await getCashoutOffer(bet.id, user.id)).toBeNull();
  });

  it("partially cashes out accumulators: settled WON legs count, remaining odds drive the price", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event1 = await makeStandardEvent();
    const event2 = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "MULTIPLE",
      stakeCents: STAKE,
      selectionIds: [sel(event1, "1X2", "1").id, sel(event2, "BTTS", "YES").id], // 2.0 × 1.8 → pw 1800
    });

    await finishEvent(event1.id, 2, 1); // leg 1 settled WON
    await settleBet(bet.id); // refreshes legs, bet stays OPEN
    expect((await db.bet.findUniqueOrThrow({ where: { id: bet.id } })).status).toBe("OPEN");

    // remaining odds 1.8 / total 3.6 → progress 0.5 → floor(1800 × 0.5 × 0.85) = 765
    const offer = await getCashoutOffer(bet.id, user.id);
    expect(offer?.offerCents).toBe(765);

    await cashoutBet(bet.id, user.id);
    expect((await balanceOf(user.id)).balanceCents).toBe(9_500 + 765);
  });

  it("is unavailable when any leg already lost", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event1 = await makeStandardEvent();
    const event2 = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "MULTIPLE",
      stakeCents: STAKE,
      selectionIds: [sel(event1, "1X2", "1").id, sel(event2, "BTTS", "YES").id],
    });

    await finishEvent(event1.id, 0, 1); // leg 1 LOST, leg 2 still open
    await settleBet(bet.id);
    expect(await getCashoutOffer(bet.id, user.id)).toBeNull();
  });

  it("refuses to cash out another user's bet", async () => {
    const owner = await makeUser({ initialBalanceCents: 10_000 });
    const stranger = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(owner.id, owner.phone), {
      type: "SINGLE",
      stakeCents: STAKE,
      selectionIds: [sel(event, "1X2", "1").id],
    });

    expect(await getCashoutOffer(bet.id, stranger.id)).toBeNull();
    await expect(cashoutBet(bet.id, stranger.id)).rejects.toThrow(/Cashout not available/i);
    expect((await balanceOf(stranger.id)).balanceCents).toBe(10_000);
  });
});
