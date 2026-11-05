import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { applyMutations, mutateWallet, COUNTER_ACCOUNTS } from "@/lib/wallet";
import { creditDepositIdempotent } from "@/lib/payments";
import { makeUser, resetDb, balanceOf, ledgerOf } from "../helpers/world";

/**
 * Wallet ledger (double-entry) invariants:
 *   1. every balance change is journaled with before/after balances,
 *   2. debits can never push the balance below zero,
 *   3. a deposit tx_ref is credited exactly once (no double credit),
 *   4. parallel mutations on one wallet never lose an update.
 */

beforeEach(resetDb);

describe("applyMutations / mutateWallet — single mutations", () => {
  it("credits increase the balance and write an auditable ledger row", async () => {
    const user = await makeUser();

    await mutateWallet([
      {
        userId: user.id,
        deltaCents: 10_000,
        entryType: "DEPOSIT",
        counterAccount: COUNTER_ACCOUNTS.PAYMENTS_CHAPA,
        refType: "deposit",
        description: "Chapa deposit",
      },
    ]);

    expect((await balanceOf(user.id)).balanceCents).toBe(10_000);
    const entries = await ledgerOf(user.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "DEPOSIT",
      direction: "CREDIT",
      amountCents: 10_000,
      balanceBeforeCents: 0,
      balanceAfterCents: 10_000,
      counterAccount: "PAYMENTS_CHAPA",
    });
  });

  it("debits reduce the balance and journal before/after balances", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });

    await mutateWallet([
      {
        userId: user.id,
        deltaCents: -4_000,
        entryType: "BET_STAKE",
        counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN,
        description: "single bet",
      },
    ]);

    expect((await balanceOf(user.id)).balanceCents).toBe(6_000);
    const stake = (await ledgerOf(user.id)).find((e) => e.entryType === "BET_STAKE");
    expect(stake).toMatchObject({
      direction: "DEBIT",
      amountCents: 4_000,
      balanceBeforeCents: 10_000,
      balanceAfterCents: 6_000,
    });
  });

  it("refuses to go negative (INSUFFICIENT_FUNDS) and leaves the balance untouched", async () => {
    const user = await makeUser({ initialBalanceCents: 1_000 });

    await expect(
      mutateWallet([
        {
          userId: user.id,
          deltaCents: -1_001,
          entryType: "BET_STAKE",
          counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN,
        },
      ])
    ).rejects.toSatisfy((err: unknown) => err instanceof ApiError && err.code === "INSUFFICIENT_FUNDS");

    // balance and ledger must be exactly as before the failed attempt
    // (only the opening top-up entry exists — no row for the rejected debit)
    expect((await balanceOf(user.id)).balanceCents).toBe(1_000);
    expect((await ledgerOf(user.id)).filter((e) => e.entryType === "BET_STAKE")).toHaveLength(0);
  });

  it("allows debiting down to exactly zero but not one cent past it", async () => {
    const user = await makeUser({ initialBalanceCents: 1_000 });
    await mutateWallet([
      { userId: user.id, deltaCents: -1_000, entryType: "BET_STAKE", counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN },
    ]);
    expect((await balanceOf(user.id)).balanceCents).toBe(0);

    await expect(
      mutateWallet([
        { userId: user.id, deltaCents: -1, entryType: "BET_STAKE", counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN },
      ])
    ).rejects.toSatisfy((err: unknown) => err instanceof ApiError && err.code === "INSUFFICIENT_FUNDS");
  });

  it("tracks the bonus bucket separately from the stakeable balance", async () => {
    const user = await makeUser({ initialBalanceCents: 2_000 });

    await mutateWallet([
      {
        userId: user.id,
        deltaCents: 500,
        bonusDeltaCents: 500,
        entryType: "BONUS",
        counterAccount: COUNTER_ACCOUNTS.PROMO_BONUS,
        description: "welcome bonus",
      },
    ]);

    const wallet = await balanceOf(user.id);
    expect(wallet.balanceCents).toBe(2_500); // bonus is real money...
    expect(wallet.bonusCents).toBe(500); // ...but tracked in its own bucket
  });

  it("withdrawal holds move funds into the locked bucket, release moves them out", async () => {
    const user = await makeUser({ initialBalanceCents: 10_000 });

    await mutateWallet([
      {
        userId: user.id,
        deltaCents: -5_000,
        lockedDeltaCents: 5_000,
        entryType: "WITHDRAWAL_HOLD",
        counterAccount: COUNTER_ACCOUNTS.HOUSE_PENDING_WITHDRAWAL,
      },
    ]);
    expect(await balanceOf(user.id)).toMatchObject({ balanceCents: 5_000, lockedCents: 5_000 });

    await mutateWallet([
      {
        userId: user.id,
        deltaCents: 0,
        lockedDeltaCents: -5_000,
        entryType: "WITHDRAWAL_SETTLE",
        counterAccount: COUNTER_ACCOUNTS.HOUSE_PENDING_WITHDRAWAL,
      },
    ]);
    expect(await balanceOf(user.id)).toMatchObject({ balanceCents: 5_000, lockedCents: 0 });
  });

  it("rejects locked-bucket operations that would go negative", async () => {
    const user = await makeUser({ initialBalanceCents: 5_000 });

    await expect(
      mutateWallet([
        {
          userId: user.id,
          deltaCents: 0,
          lockedDeltaCents: -1,
          entryType: "WITHDRAWAL_SETTLE",
          counterAccount: COUNTER_ACCOUNTS.HOUSE_PENDING_WITHDRAWAL,
        },
      ])
    ).rejects.toSatisfy((err: unknown) => err instanceof ApiError && err.code === "INVALID_WALLET_OP");
  });

  it("fails cleanly when the wallet does not exist", async () => {
    await expect(
      mutateWallet([
        { userId: "no-such-user", deltaCents: 100, entryType: "DEPOSIT", counterAccount: "PAYMENTS_CHAPA" },
      ])
    ).rejects.toSatisfy((err: unknown) => err instanceof ApiError && err.code === "WALLET_NOT_FOUND");
  });

  it("keeps the ledger chain consistent across a sequence of mixed mutations", async () => {
    const user = await makeUser({ initialBalanceCents: 1_000 });
    await mutateWallet([
      { userId: user.id, deltaCents: 2_500, entryType: "DEPOSIT", counterAccount: COUNTER_ACCOUNTS.PAYMENTS_CHAPA },
    ]);
    await mutateWallet([
      { userId: user.id, deltaCents: -1_200, entryType: "BET_STAKE", counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN },
    ]);
    await mutateWallet([
      { userId: user.id, deltaCents: 700, entryType: "BET_WIN", counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN },
    ]);

    const entries = await ledgerOf(user.id);
    expect(entries).toHaveLength(4); // top-up + 3 mutations

    // every row's after-balance = before-balance ± amount, and after >= 0
    for (const e of entries) {
      const delta = e.direction === "CREDIT" ? e.amountCents : -e.amountCents;
      expect(e.balanceAfterCents).toBe(e.balanceBeforeCents + delta);
      expect(e.balanceAfterCents).toBeGreaterThanOrEqual(0);
    }
    // ledger deltas reconcile with the wallet balance exactly (no lost update)
    const deltaSum = entries.reduce((acc, e) => acc + (e.balanceAfterCents - e.balanceBeforeCents), 0);
    expect(deltaSum).toBe((await balanceOf(user.id)).balanceCents);
  });

  it("supports caller-provided transactions so wallet changes compose atomically", async () => {
    const user = await makeUser({ initialBalanceCents: 5_000 });
    await db.$transaction(async (tx) => {
      await applyMutations(tx, [
        { userId: user.id, deltaCents: -2_000, entryType: "BET_STAKE", counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN },
      ]);
    });
    expect((await balanceOf(user.id)).balanceCents).toBe(3_000);
  });
});

describe("double-credit protection (deposit idempotency)", () => {
  const depositCents = 10_000;

  async function makePendingDeposit(userId: string, txRef: string) {
    await db.deposit.create({
      data: { userId, txRef, amountCents: depositCents, status: "PENDING" },
    });
  }

  it("credits a deposit exactly once on repeated calls", async () => {
    const user = await makeUser();
    const txRef = `GAD-T-${randomUUID().slice(0, 8)}`;
    await makePendingDeposit(user.id, txRef);

    const first = await creditDepositIdempotent(txRef);
    expect(first.credited).toBe(true);

    const second = await creditDepositIdempotent(txRef);
    expect(second.credited).toBe(false);

    // credited once: deposit + 100% welcome bonus (default settings)
    expect(await balanceOf(user.id)).toMatchObject({ balanceCents: 20_000, bonusCents: 10_000 });
    const depositEntries = (await ledgerOf(user.id)).filter((e) => e.entryType === "DEPOSIT");
    expect(depositEntries).toHaveLength(1);
    expect((await db.deposit.findUniqueOrThrow({ where: { txRef } })).status).toBe("SUCCESS");
  });

  it("credits exactly once when two webhook workers race on the same tx_ref", async () => {
    const user = await makeUser();
    const txRef = `GAD-T-${randomUUID().slice(0, 8)}`;
    await makePendingDeposit(user.id, txRef);

    const [a, b] = await Promise.all([creditDepositIdempotent(txRef), creditDepositIdempotent(txRef)]);
    const credited = [a.credited, b.credited].filter(Boolean).length;
    expect(credited).toBe(1); // the deposit row is the claim; the loser is a no-op

    expect((await balanceOf(user.id)).balanceCents).toBe(20_000);
    expect((await ledgerOf(user.id)).filter((e) => e.entryType === "DEPOSIT")).toHaveLength(1);
  });

  it("pays the welcome bonus only on the first successful deposit", async () => {
    const user = await makeUser();
    const ref1 = `GAD-T-${randomUUID().slice(0, 8)}`;
    const ref2 = `GAD-T-${randomUUID().slice(0, 8)}`;
    await makePendingDeposit(user.id, ref1);
    await makePendingDeposit(user.id, ref2);

    await creditDepositIdempotent(ref1); // first → bonus applies
    await creditDepositIdempotent(ref2); // second → deposit only

    // 10,000 + 10,000 (first) + 10,000 (second) = 30,000; bonus bucket stays 10,000
    expect(await balanceOf(user.id)).toMatchObject({ balanceCents: 30_000, bonusCents: 10_000 });
  });

  it("does not credit a FAILED deposit", async () => {
    const user = await makeUser();
    const txRef = `GAD-T-${randomUUID().slice(0, 8)}`;
    await db.deposit.create({
      data: { userId: user.id, txRef, amountCents: depositCents, status: "FAILED" },
    });

    const result = await creditDepositIdempotent(txRef);
    expect(result.credited).toBe(false);
    expect((await balanceOf(user.id)).balanceCents).toBe(0);
  });
});

describe("concurrency on a single wallet", () => {
  it("20 parallel deposits land the exact total (no lost update)", async () => {
    const user = await makeUser();

    await Promise.all(
      Array.from({ length: 20 }, () =>
        mutateWallet([
          {
            userId: user.id,
            deltaCents: 1_000,
            entryType: "DEPOSIT",
            counterAccount: COUNTER_ACCOUNTS.PAYMENTS_CHAPA,
          },
        ])
      )
    );

    expect((await balanceOf(user.id)).balanceCents).toBe(20_000);
    const entries = await ledgerOf(user.id);
    expect(entries).toHaveLength(20);
    // ledger deltas reconcile to the wallet balance to the cent
    const deltaSum = entries.reduce((acc, e) => acc + (e.balanceAfterCents - e.balanceBeforeCents), 0);
    expect(deltaSum).toBe(20_000);
  });

  it("20 parallel debits of the same wallet never overdraw", async () => {
    // balance allows exactly 10 of the 20 debits
    const user = await makeUser({ initialBalanceCents: 10_000 });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        mutateWallet([
          {
            userId: user.id,
            deltaCents: -1_000,
            entryType: "BET_STAKE",
            counterAccount: COUNTER_ACCOUNTS.HOUSE_MAIN,
          },
        ])
      )
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(10);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
      expect(((r as PromiseRejectedResult).reason as ApiError).code).toBe("INSUFFICIENT_FUNDS");
    }

    expect((await balanceOf(user.id)).balanceCents).toBe(0);
    const entries = await ledgerOf(user.id);
    expect(entries).toHaveLength(11); // 1 opening top-up + 10 successful debits
    for (const e of entries) {
      expect(e.balanceAfterCents).toBeGreaterThanOrEqual(0);
    }
    expect(entries.filter((e) => e.entryType === "BET_STAKE")).toHaveLength(10);
  });
});
