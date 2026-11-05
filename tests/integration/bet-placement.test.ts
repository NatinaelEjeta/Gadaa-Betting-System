import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { placeBet, confirmPendingLiveBets, voidAndRefundBet } from "@/lib/bets";
import { makeUser, resetDb, balanceOf, ledgerOf, makeEvent, makeStandardEvent, sel, FUTURE_START } from "../helpers/world";

/**
 * Bet placement pipeline: structure validation, responsible-gambling gates,
 * selection/event state checks, odds math, and the atomic wallet debit +
 * bet + legs transaction. Live bets additionally go through the 5s
 * PENDING_ACCEPTANCE window.
 */

const USER = (id: string, phone: string) => ({ id, phone });

beforeEach(resetDb);

describe("single bets — happy path", () => {
  it("debits the stake, snapshots the leg, and stores correct odds math", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const selection = sel(event, "1X2", "1");

    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: 500,
      selectionIds: [selection.id],
    });

    expect(bet.status).toBe("OPEN");
    expect(bet.type).toBe("SINGLE");
    expect(bet.stakeCents).toBe(500);
    expect(bet.totalOdds).toBe(2.0);
    expect(bet.potentialWinCents).toBe(1_000);
    expect(bet.liveAcceptAt).toBeNull();

    expect(bet.legs).toHaveLength(1);
    expect(bet.legs[0]).toMatchObject({
      eventId: event.id,
      marketId: selection.marketId,
      selectionId: selection.id,
      selectionName: "1",
      oddsAtPlacement: 2.0,
      status: "OPEN",
    });

    expect((await balanceOf(user.id)).balanceCents).toBe(9_500);
    const stake = (await ledgerOf(user.id)).find((e) => e.entryType === "BET_STAKE");
    expect(stake).toMatchObject({ direction: "DEBIT", amountCents: 500, balanceBeforeCents: 10_000, balanceAfterCents: 9_500 });
  });

  it("requires exactly one selection for a SINGLE", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const a = sel(event, "1X2", "1");
    const b = sel(event, "BTTS", "YES");

    await expect(
      placeBet(USER(user.id, user.phone), { type: "SINGLE", stakeCents: 500, selectionIds: [a.id, b.id] })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "INVALID_STRUCTURE");
  });
});

describe("accumulator bets", () => {
  it("multiplies odds and potential win across legs", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();

    const bet = await placeBet(USER(user.id, user.phone), {
      type: "MULTIPLE",
      stakeCents: 500,
      selectionIds: [sel(event, "1X2", "1").id, sel(event, "BTTS", "YES").id],
    });

    expect(bet.type).toBe("MULTIPLE");
    expect(bet.totalOdds).toBe(3.6); // 2.0 × 1.8
    expect(bet.potentialWinCents).toBe(1_800); // floor(500 × 3.6)
    expect(bet.comboCount).toBe(1);
    expect((await balanceOf(user.id)).balanceCents).toBe(9_500);
  });

  it("requires at least two selections", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();

    await expect(
      placeBet(USER(user.id, user.phone), { type: "MULTIPLE", stakeCents: 500, selectionIds: [sel(event, "1X2", "1").id] })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "INVALID_STRUCTURE");
  });

  it("rejects duplicate selections", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const s = sel(event, "1X2", "1");

    await expect(
      placeBet(USER(user.id, user.phone), { type: "MULTIPLE", stakeCents: 500, selectionIds: [s.id, s.id] })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "INVALID_STRUCTURE");
  });

  it("cannot combine two selections from the same market", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();

    await expect(
      placeBet(USER(user.id, user.phone), {
        type: "MULTIPLE",
        stakeCents: 500,
        selectionIds: [sel(event, "1X2", "1").id, sel(event, "1X2", "X").id],
      })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "SAME_MARKET");
  });
});

describe("system bets", () => {
  it("prices k-combinations: stake per combo × C(n,k), full product for potential win", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();

    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SYSTEM",
      systemK: 2,
      stakeCents: 500, // per combination
      selectionIds: [sel(event, "1X2", "1").id, sel(event, "BTTS", "YES").id, sel(event, "OVER_UNDER_2_5", "OVER").id],
    });

    expect(bet.type).toBe("SYSTEM");
    expect(bet.systemK).toBe(2);
    expect(bet.comboCount).toBe(3); // C(3,2) = 3 doubles
    expect(bet.stakePerComboCents).toBe(500);
    expect(bet.stakeCents).toBe(1_500); // total outlay
    expect(bet.totalOdds).toBe(6.84); // 2.0 × 1.8 × 1.9
    expect(bet.potentialWinCents).toBe(3_420); // floor(500 × 6.84)
    expect((await balanceOf(user.id)).balanceCents).toBe(8_500);
  });

  it("requires a combination size k ≥ 2 and more legs than k", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const ids = [sel(event, "1X2", "1").id, sel(event, "BTTS", "YES").id, sel(event, "OVER_UNDER_2_5", "OVER").id];

    await expect(
      placeBet(USER(user.id, user.phone), { type: "SYSTEM", systemK: 1, stakeCents: 500, selectionIds: ids })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "INVALID_STRUCTURE");

    await expect(
      placeBet(USER(user.id, user.phone), { type: "SYSTEM", systemK: 3, stakeCents: 500, selectionIds: ids })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "INVALID_STRUCTURE");
  });
});

describe("validation & rejections", () => {
  it("rejects insufficient funds without leaving any trace", async () => {
    const user = await makeUser({ initialBalanceCents: 499 });
    const event = await makeStandardEvent();

    await expect(
      placeBet(USER(user.id, user.phone), {
        type: "SINGLE",
        stakeCents: 500,
        selectionIds: [sel(event, "1X2", "1").id],
      })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "INSUFFICIENT_FUNDS");

    expect(await db.bet.count({ where: { userId: user.id } })).toBe(0);
    expect((await balanceOf(user.id)).balanceCents).toBe(499);
    // only the opening top-up entry exists — nothing for the rejected bet
    expect((await ledgerOf(user.id)).filter((e) => e.entryType === "BET_STAKE")).toHaveLength(0);
  });

  it("enforces min/max stake limits", async () => {
    const user = await makeUser({ initialBalanceCents: 3_000_000 });
    const event = await makeStandardEvent();
    const selection = sel(event, "1X2", "1");

    await expect(
      placeBet(USER(user.id, user.phone), { type: "SINGLE", stakeCents: 100, selectionIds: [selection.id] })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "MIN_STAKE");

    await expect(
      placeBet(USER(user.id, user.phone), { type: "SINGLE", stakeCents: 2_000_001, selectionIds: [selection.id] })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "MAX_STAKE");

    // nothing was debited by the failed attempts
    expect((await balanceOf(user.id)).balanceCents).toBe(3_000_000);
  });

  it("enforces the maximum number of legs", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeEvent({
      status: "SCHEDULED",
      startTime: FUTURE_START(),
      markets: Array.from({ length: 21 }, (_, i) => ({
        key: `BTTS_${i}`,
        name: `BTTS book ${i + 1}`,
        selections: { YES: 1.8 },
      })),
    });
    const ids = event.markets.map((m) => m.selections[0].id);

    await expect(
      placeBet(USER(user.id, user.phone), { type: "MULTIPLE", stakeCents: 500, selectionIds: ids })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "MAX_LEGS");
  });

  it("rejects suspended selections", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const selection = sel(event, "1X2", "1");
    await db.selection.update({ where: { id: selection.id }, data: { status: "SUSPENDED" } });

    await expect(
      placeBet(USER(user.id, user.phone), { type: "SINGLE", stakeCents: 500, selectionIds: [selection.id] })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "SELECTION_SUSPENDED");
  });

  it("rejects suspended markets", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const selection = sel(event, "1X2", "1");
    await db.market.update({ where: { id: selection.marketId }, data: { status: "SUSPENDED" } });

    await expect(
      placeBet(USER(user.id, user.phone), { type: "SINGLE", stakeCents: 500, selectionIds: [selection.id] })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "SELECTION_SUSPENDED");
  });

  it("rejects selections on finished events", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent({ status: "FINISHED", homeScore: 2, awayScore: 1 });

    await expect(
      placeBet(USER(user.id, user.phone), {
        type: "SINGLE",
        stakeCents: 500,
        selectionIds: [sel(event, "1X2", "1").id],
      })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "EVENT_CLOSED");
  });

  it("rejects selections that no longer exist", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });

    await expect(
      placeBet(USER(user.id, user.phone), { type: "SINGLE", stakeCents: 500, selectionIds: ["sel-gone"] })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "SELECTION_GONE");
  });
});

describe("live bets — acceptance delay", () => {
  function liveEvent() {
    return makeStandardEvent({
      status: "LIVE",
      startTime: new Date(Date.now() - 600_000), // kicked off 10 minutes ago
    });
  }

  it("places live bets into PENDING_ACCEPTANCE with a delay deadline", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await liveEvent();

    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: 500,
      selectionIds: [sel(event, "1X2", "1").id],
    });

    expect(bet.status).toBe("PENDING_ACCEPTANCE");
    expect(bet.liveAcceptAt).not.toBeNull();
    // stake is already debited — it comes back if the bet is voided
    expect((await balanceOf(user.id)).balanceCents).toBe(9_500);
  });

  it("confirms a pending live bet when the odds did not move", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await liveEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: 500,
      selectionIds: [sel(event, "1X2", "1").id],
    });

    await db.bet.update({
      where: { id: bet.id },
      data: { liveAcceptAt: new Date(Date.now() - 1_000) }, // delay elapsed
    });
    const results = await confirmPendingLiveBets();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ userId: user.id, kind: "bet_accepted" });
    expect((await db.bet.findUniqueOrThrow({ where: { id: bet.id } })).status).toBe("OPEN");
  });

  it("voids and refunds a pending live bet when the odds moved meanwhile", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await liveEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: 500,
      selectionIds: [sel(event, "1X2", "1").id],
    });

    await db.selection.update({ where: { id: bet.legs[0].selectionId }, data: { odds: 2.6 } });
    await db.bet.update({ where: { id: bet.id }, data: { liveAcceptAt: new Date(Date.now() - 1_000) } });

    const results = await confirmPendingLiveBets();
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("bet_voided");

    const settled = await db.bet.findUniqueOrThrow({ where: { id: bet.id } });
    expect(settled.status).toBe("VOID");
    expect((await balanceOf(user.id)).balanceCents).toBe(10_000); // full refund
    expect((await ledgerOf(user.id)).filter((e) => e.entryType === "BET_REFUND")).toHaveLength(1);
  });
});

describe("void & refund", () => {
  it("refunds an OPEN bet once; repeated calls are no-ops", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const event = await makeStandardEvent();
    const bet = await placeBet(USER(user.id, user.phone), {
      type: "SINGLE",
      stakeCents: 500,
      selectionIds: [sel(event, "1X2", "1").id],
    });

    await voidAndRefundBet(bet.id, "Market suspended by trader");
    await voidAndRefundBet(bet.id, "Market suspended by trader"); // second call must not double-refund

    expect((await db.bet.findUniqueOrThrow({ where: { id: bet.id } })).status).toBe("VOID");
    expect((await balanceOf(user.id)).balanceCents).toBe(10_000);
    expect((await ledgerOf(user.id)).filter((e) => e.entryType === "BET_REFUND")).toHaveLength(1);
  });
});
