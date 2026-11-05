import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { mutateWallet, COUNTER_ACCOUNTS } from "@/lib/wallet";
import { placeBet } from "@/lib/bets";
import { makeUser, resetDb, balanceOf, ledgerOf, makeStandardEvent, sel } from "../helpers/world";

/**
 * Concurrency: 50 parallel bets fired at one wallet.
 *
 * The invariant under attack is the classic double-spend: 50 requests each
 * read "enough money" at roughly the same time and all try to debit. The
 * ledger must serialize them — exactly the affordable number of bets goes
 * through, every rejection is a clean INSUFFICIENT_FUNDS, and at no point
 * does the journal show a negative or inconsistent balance.
 *
 * (In the test harness all queries flow through a single connection so the
 * ordering is deterministic; on production PostgreSQL the same invariants
 * hold via the transaction + optimistic version guard in wallet.ts.)
 */

const USER = (id: string, phone: string) => ({ id, phone });

beforeEach(resetDb);

describe("50 parallel bets on one wallet", () => {
  it("admits exactly the affordable bets, rejects the rest, and balances to the cent", async () => {
    // 20,000 cents = 200 ETB; stake 500 cents (5 ETB) → exactly 40 bets affordable
    const user = await makeUser({ initialBalanceCents: 20_000 });
    const event = await makeStandardEvent();
    const selection = sel(event, "1X2", "1");

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        placeBet(USER(user.id, user.phone), {
          type: "SINGLE",
          stakeCents: 500,
          selectionIds: [selection.id],
        })
      )
    );

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof placeBet>>> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(40);
    expect(rejected).toHaveLength(10);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(ApiError);
      expect((r.reason as ApiError).code).toBe("INSUFFICIENT_FUNDS");
      expect((r.reason as ApiError).status).toBe(400);
    }

    // --- wallet state ---
    expect((await balanceOf(user.id)).balanceCents).toBe(0); // 20,000 − 40×500 exactly

    // --- ledger state ---
    const entries = await ledgerOf(user.id);
    expect(entries).toHaveLength(41); // 1 top-up + 40 stake debits

    // no negative balance at any point in the journal
    for (const e of entries) {
      expect(e.balanceAfterCents).toBeGreaterThanOrEqual(0);
      expect(e.balanceBeforeCents).toBeGreaterThanOrEqual(0);
    }

    // journal deltas reconcile with the wallet balance exactly — no lost update
    const deltaSum = entries.reduce((acc, e) => acc + (e.balanceAfterCents - e.balanceBeforeCents), 0);
    expect(deltaSum).toBe(20_000 - 40 * 500);

    // every successful bet is backed by exactly one BET_STAKE debit, and
    // every debit belongs to one of the accepted bets (no orphan money moves)
    expect(await db.bet.count({ where: { userId: user.id } })).toBe(40);
    const stakeEntries = entries.filter((e) => e.entryType === "BET_STAKE");
    expect(stakeEntries).toHaveLength(40);
    const debitedBets = new Set(stakeEntries.map((e) => e.refId));
    for (const bet of fulfilled) expect(debitedBets.has(bet.value.id)).toBe(true);

    // optimistic version token advanced once per applied mutation
    expect((await balanceOf(user.id)).version).toBe(41);
  });

  it("lets all 50 succeed when the balance covers them — final balance is exact", async () => {
    const user = await makeUser({ initialBalanceCents: 1_000_000 }); // 10,000 ETB
    const event = await makeStandardEvent();
    const selection = sel(event, "BTTS", "YES");

    const bets = await Promise.all(
      Array.from({ length: 50 }, () =>
        placeBet(USER(user.id, user.phone), {
          type: "SINGLE",
          stakeCents: 500,
          selectionIds: [selection.id],
        })
      )
    );

    expect(bets).toHaveLength(50);
    expect(new Set(bets.map((b) => b.id)).size).toBe(50); // all distinct
    expect((await balanceOf(user.id)).balanceCents).toBe(1_000_000 - 25_000);
    expect(await db.ledgerEntry.count({ where: { wallet: { userId: user.id } } })).toBe(51);
  });

  it("mixed parallel deposits and debits on one wallet reconcile exactly", async () => {
    // 10,000 opening balance; 10 bets and 10 deposits of 1,000 race each other.
    // The debits can never exceed the opening balance, so ALL of them must succeed.
    const user = await makeUser({ initialBalanceCents: 10_000 });
    const events = await Promise.all(Array.from({ length: 10 }, () => makeStandardEvent()));
    const selectionIds = events.map((e) => sel(e, "1X2", "1").id);

    const operations: Promise<unknown>[] = [
      ...selectionIds.map((id) =>
        placeBet(USER(user.id, user.phone), {
          type: "SINGLE",
          stakeCents: 1_000,
          selectionIds: [id],
        })
      ),
      ...Array.from({ length: 10 }, () =>
        mutateWallet([
          {
            userId: user.id,
            deltaCents: 1_000,
            entryType: "DEPOSIT",
            counterAccount: COUNTER_ACCOUNTS.PAYMENTS_CHAPA,
          },
        ])
      ),
    ];
    await Promise.all(operations);

    expect((await balanceOf(user.id)).balanceCents).toBe(10_000); // +10,000 −10,000
    const entries = await ledgerOf(user.id);
    expect(entries).toHaveLength(21); // top-up + 10 debits + 10 credits
    expect(entries.filter((e) => e.entryType === "BET_STAKE")).toHaveLength(10);
    expect(entries.filter((e) => e.entryType === "DEPOSIT")).toHaveLength(11); // incl. top-up
    for (const e of entries) expect(e.balanceAfterCents).toBeGreaterThanOrEqual(0);
    expect((await balanceOf(user.id)).version).toBe(21);
  });
});
