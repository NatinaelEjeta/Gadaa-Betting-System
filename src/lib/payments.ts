import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { applyMutations, mutateWallet, COUNTER_ACCOUNTS } from "@/lib/wallet";
import { assertCanDeposit } from "@/lib/responsible";
import { notify, logAudit } from "@/lib/audit";
import {
  initializeTransaction,
  verifyTransaction,
  initiateTransfer,
  chapaTestMode,
  APP_URL,
} from "@/lib/chapa";
import { randomUUID } from "crypto";

/**
 * Payment business logic: deposit lifecycle (initialize → webhook → verify →
 * idempotent credit) and withdrawal lifecycle (hold → approve/reject → payout).
 */

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export async function createDeposit(user: { id: string; phone: string; fullName: string }, amountCents: number) {
  const settings = await getSettings();
  if (amountCents < settings.minDepositCents) {
    throw new ApiError(`Minimum deposit is ${settings.minDepositCents / 100} ETB`, 400, "MIN_DEPOSIT");
  }
  if (amountCents > settings.maxDepositCents) {
    throw new ApiError(`Maximum deposit is ${settings.maxDepositCents / 100} ETB`, 400, "MAX_DEPOSIT");
  }
  await assertCanDeposit(user.id, amountCents);

  const txRef = `GAD-${Date.now()}-${randomUUID().slice(0, 8)}`.toUpperCase();
  const deposit = await db.deposit.create({
    data: {
      userId: user.id,
      txRef,
      amountCents,
      status: "PENDING",
      metaJson: JSON.stringify({ testMode: chapaTestMode }),
    },
  });

  const init = await initializeTransaction({
    txRef,
    amountCents,
    phone: user.phone,
    fullName: user.fullName,
    callbackUrl: `${APP_URL}/api/webhooks/chapa`,
    returnUrl: `${APP_URL}/?deposit=return`,
  });

  await db.deposit.update({
    where: { id: deposit.id },
    data: { checkoutUrl: init.checkoutUrl, providerRef: init.providerRef },
  });

  await db.transaction.create({
    data: {
      userId: user.id,
      type: "DEPOSIT",
      status: "PENDING",
      amountCents,
      reference: txRef,
      provider: "CHAPA",
      description: `Deposit via Chapa${chapaTestMode ? " (test mode)" : ""}`,
    },
  });

  return { depositId: deposit.id, txRef, checkoutUrl: init.checkoutUrl };
}

/**
 * Credit a deposit exactly once. Called after webhook receipt AND server-side
 * verification. Idempotency: the txRef is unique and the deposit row acts as
 * the claim — the status flip happens inside the same transaction as the
 * wallet credit, so double calls/double webhooks can never double-credit.
 */
export async function creditDepositIdempotent(txRef: string, providerRef?: string) {
  // Read config OUTSIDE the transaction: it never participates in the credit
  // invariant and holding the txn open during the read would waste (and on
  // single-connection pools, deadlock) the pool.
  const settings = await getSettings();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const deposit = await tx.deposit.findUnique({
          where: { txRef },
          include: { user: { include: { referredBy: true, wallet: true, deposits: { where: { status: "SUCCESS" } } } } },
        });
        if (!deposit) throw new ApiError("Deposit not found", 404, "DEPOSIT_NOT_FOUND");
        if (deposit.status === "SUCCESS") return { credited: false, deposit };
        if (deposit.status === "FAILED") return { credited: false, deposit };

        const mutations = [
          {
            userId: deposit.userId,
            deltaCents: deposit.amountCents,
            entryType: "DEPOSIT" as const,
            counterAccount: COUNTER_ACCOUNTS.PAYMENTS_CHAPA,
            refType: "deposit",
            refId: deposit.id,
            description: `Chapa deposit ${txRef}`,
            txRow: undefined,
          },
        ];

        // Welcome bonus on the user's first successful deposit
        const isFirstDeposit = deposit.user.deposits.length === 0;
        let bonusCents = 0;
        if (isFirstDeposit && settings.welcomeBonusPercent > 0) {
          bonusCents = Math.min(
            Math.floor((deposit.amountCents * settings.welcomeBonusPercent) / 100),
            settings.welcomeBonusMaxCents
          );
        }

        await applyMutations(tx, mutations);

        await tx.deposit.update({
          where: { id: deposit.id },
          data: { status: "SUCCESS", creditedAt: new Date(), providerRef: providerRef ?? deposit.providerRef },
        });
        await tx.transaction.updateMany({
          where: { reference: txRef, type: "DEPOSIT" },
          data: { status: "SUCCESS" },
        });

        if (bonusCents > 0) {
          const activeWelcome = await tx.bonus.findFirst({ where: { type: "WELCOME", active: true } });
          await applyMutations(tx, [
            {
              userId: deposit.userId,
              deltaCents: bonusCents,
              bonusDeltaCents: bonusCents,
              entryType: "BONUS" as const,
              counterAccount: COUNTER_ACCOUNTS.PROMO_BONUS,
              refType: "bonus",
              refId: activeWelcome?.id,
              description: `Welcome bonus ${settings.welcomeBonusPercent}% on first deposit`,
              txRow: {
                type: "BONUS",
                status: "SUCCESS",
                amountCents: bonusCents,
                description: "Welcome bonus",
              },
            },
          ]);
          await tx.bonusGrant.create({
            data: {
              userId: deposit.userId,
              bonusId: activeWelcome?.id,
              amountCents: bonusCents,
              reason: "Welcome bonus (first deposit)",
            },
          });
        }

        // Referral reward: referrer gets a one-time bonus when the referee's
        // first deposit lands.
        const referrerId = deposit.user.referredById;
        if (referrerId && isFirstDeposit && settings.referralBonusCents > 0) {
          const referral = await tx.referral.findUnique({ where: { refereeId: deposit.userId } });
          if (referral && referral.status === "PENDING") {
            await applyMutations(tx, [
              {
                userId: referrerId,
                deltaCents: settings.referralBonusCents,
                entryType: "BONUS" as const,
                counterAccount: COUNTER_ACCOUNTS.PROMO_BONUS,
                refType: "referral",
                refId: referral.id,
                description: "Referral bonus",
                txRow: {
                  type: "BONUS",
                  status: "SUCCESS",
                  amountCents: settings.referralBonusCents,
                  description: "Referral bonus",
                },
              },
            ]);
            await tx.referral.update({
              where: { id: referral.id },
              data: { status: "REWARDED", rewardedCents: settings.referralBonusCents },
            });
            await tx.notification.create({
              data: {
                userId: referrerId,
                type: "BONUS",
                title: "Referral bonus",
                body: `You earned ${settings.referralBonusCents / 100} ETB for a friend's first deposit!`,
              },
            });
          }
        }

        await tx.notification.create({
          data: {
            userId: deposit.userId,
            type: "DEPOSIT",
            title: "Deposit confirmed",
            body: `${deposit.amountCents / 100} ETB has been added to your wallet${bonusCents ? ` + ${bonusCents / 100} ETB welcome bonus` : ""}.`,
          },
        });

        return { credited: true, deposit, bonusCents };
      }, { timeout: 15_000 });
    } catch (err) {
      if (err instanceof Error && err.message === "wallet version conflict" && attempt < 3) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

/** Fraud signal: >3 deposits within 60 seconds gets flagged for review. */
export async function fraudCheckDepositVelocity(userId: string) {
  const since = new Date(Date.now() - 60_000);
  const count = await db.deposit.count({ where: { userId, createdAt: { gte: since } } });
  if (count > 3) {
    await logAudit({
      action: "FRAUD_FLAG",
      entity: "user",
      entityId: userId,
      details: { reason: "deposit_velocity", depositsLastMinute: count },
    });
  }
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

export async function requestWithdrawal(
  user: { id: string },
  input: { amountCents: number; method: string; accountName: string; accountNumber: string; bankName?: string }
) {
  const settings = await getSettings();
  if (input.amountCents < settings.minWithdrawalCents) {
    throw new ApiError(`Minimum withdrawal is ${settings.minWithdrawalCents / 100} ETB`, 400, "MIN_WITHDRAWAL");
  }
  if (input.amountCents > settings.maxWithdrawalCents) {
    throw new ApiError(`Maximum withdrawal is ${settings.maxWithdrawalCents / 100} ETB`, 400, "MAX_WITHDRAWAL");
  }
  if (input.method === "BANK" && !input.bankName) {
    throw new ApiError("Bank name is required for bank transfers", 422, "VALIDATION_ERROR");
  }

  const feeCents = Math.floor((input.amountCents * settings.withdrawalFeeBps) / 10_000);

  // Hold the funds immediately (debit balance, credit locked bucket) so the
  // money can't be staked while the request is pending.
  const result = await mutateWallet([
    {
      userId: user.id,
      deltaCents: -(input.amountCents),
      lockedDeltaCents: input.amountCents,
      entryType: "WITHDRAWAL_HOLD",
      counterAccount: COUNTER_ACCOUNTS.HOUSE_PENDING_WITHDRAWAL,
      refType: "withdrawal",
      description: `Withdrawal hold (${input.method})`,
    },
  ]);

  const withdrawal = await db.withdrawal.create({
    data: {
      userId: user.id,
      amountCents: input.amountCents,
      feeCents,
      method: input.method,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      bankName: input.bankName,
      status: "PENDING",
    },
  });
  await db.transaction.create({
    data: {
      userId: user.id,
      type: "WITHDRAWAL",
      status: "PENDING",
      amountCents: input.amountCents,
      provider: "CHAPA",
      description: `Withdrawal to ${input.method}`,
      metaJson: JSON.stringify({ withdrawalId: withdrawal.id }),
    },
  });
  return { withdrawal, balance: result[0].balanceCents };
}

/** Finance/admin approval → pays out via Chapa Transfers. */
export async function approveWithdrawal(
  admin: { id: string; phone: string },
  withdrawalId: string,
  note?: string
) {
  const withdrawal = await db.withdrawal.findUnique({ where: { id: withdrawalId }, include: { user: true } });
  if (!withdrawal) throw new ApiError("Withdrawal not found", 404, "NOT_FOUND");
  if (withdrawal.status !== "PENDING" && withdrawal.status !== "PROCESSING") {
    throw new ApiError(`Withdrawal already ${withdrawal.status}`, 400, "INVALID_STATE");
  }

  await db.withdrawal.update({
    where: { id: withdrawalId },
    data: { status: "PROCESSING", processedById: admin.id, processedAt: new Date() },
  });

  const transfer = await initiateTransfer({
    reference: withdrawal.id,
    amountCents: withdrawal.amountCents - withdrawal.feeCents,
    method: withdrawal.method as "TELEBIRR" | "CBE_BIRR" | "BANK",
    accountName: withdrawal.accountName,
    accountNumber: withdrawal.accountNumber,
    bankName: withdrawal.bankName ?? undefined,
  });

  if (!transfer.success) {
    // Payout failed → release the hold back to the balance
    await mutateWallet([
      {
        userId: withdrawal.userId,
        deltaCents: withdrawal.amountCents,
        lockedDeltaCents: -withdrawal.amountCents,
        entryType: "WITHDRAWAL_REFUND",
        counterAccount: COUNTER_ACCOUNTS.HOUSE_PENDING_WITHDRAWAL,
        refType: "withdrawal",
        refId: withdrawal.id,
        description: "Payout failed — funds returned",
      },
    ]);
    await db.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: "FAILED", adminNote: [transfer.message, note].filter(Boolean).join(" | ") || "Transfer failed" },
    });
    await db.transaction.updateMany({
      where: { metaJson: { contains: withdrawalId }, type: "WITHDRAWAL" },
      data: { status: "FAILED" },
    });
    throw new ApiError(`Chapa transfer failed: ${transfer.message ?? "unknown"}`, 502, "TRANSFER_FAILED");
  }

  // Success: the held funds leave the locked bucket (system side).
  await mutateWallet([
    {
      userId: withdrawal.userId,
      deltaCents: 0,
      lockedDeltaCents: -withdrawal.amountCents,
      entryType: "WITHDRAWAL_SETTLE",
      counterAccount: COUNTER_ACCOUNTS.HOUSE_PENDING_WITHDRAWAL,
      refType: "withdrawal",
      refId: withdrawal.id,
      description: `Payout via ${withdrawal.method} (${transfer.providerRef})`,
    },
  ]);
  await db.withdrawal.update({
    where: { id: withdrawalId },
    data: {
      status: "PAID",
      processedById: admin.id,
      processedAt: new Date(),
      adminNote: note,
    },
  });
  await db.transaction.updateMany({
    where: { metaJson: { contains: withdrawalId }, type: "WITHDRAWAL" },
    data: { status: "SUCCESS" },
  });
  await notify(withdrawal.userId, "WITHDRAWAL", "Withdrawal paid", `${withdrawal.amountCents / 100} ETB sent via ${withdrawal.method}.`);
  await logAudit({
    actorId: admin.id,
    actorPhone: admin.phone,
    action: "WITHDRAWAL_APPROVE",
    entity: "withdrawal",
    entityId: withdrawalId,
    details: { amountCents: withdrawal.amountCents, providerRef: transfer.providerRef },
  });
}

export async function rejectWithdrawal(admin: { id: string; phone: string }, withdrawalId: string, note?: string) {
  const withdrawal = await db.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new ApiError("Withdrawal not found", 404, "NOT_FOUND");
  if (withdrawal.status !== "PENDING" && withdrawal.status !== "PROCESSING") {
    throw new ApiError(`Withdrawal already ${withdrawal.status}`, 400, "INVALID_STATE");
  }
  await mutateWallet([
    {
      userId: withdrawal.userId,
      deltaCents: withdrawal.amountCents,
      lockedDeltaCents: -withdrawal.amountCents,
      entryType: "WITHDRAWAL_REFUND",
      counterAccount: COUNTER_ACCOUNTS.HOUSE_PENDING_WITHDRAWAL,
      refType: "withdrawal",
      refId: withdrawal.id,
      description: "Withdrawal rejected — funds returned",
    },
  ]);
  await db.withdrawal.update({
    where: { id: withdrawalId },
    data: { status: "REJECTED", processedById: admin.id, processedAt: new Date(), adminNote: note },
  });
  await db.transaction.updateMany({
    where: { metaJson: { contains: withdrawalId }, type: "WITHDRAWAL" },
    data: { status: "REFUNDED" },
  });
  await notify(withdrawal.userId, "WITHDRAWAL", "Withdrawal rejected", `${withdrawal.amountCents / 100} ETB returned to your wallet.`);
  await logAudit({
    actorId: admin.id,
    actorPhone: admin.phone,
    action: "WITHDRAWAL_REJECT",
    entity: "withdrawal",
    entityId: withdrawalId,
    details: { amountCents: withdrawal.amountCents, note },
  });
}

/**
 * Verify-then-credit helper shared by the webhook route and the test-mode
 * mock checkout. Enforces: signature (route-level) + verify endpoint + idempotency.
 */
export async function verifyAndCreditDeposit(txRef: string) {
  const verification = await verifyTransaction(txRef);
  if (!verification.success) {
    return { credited: false as const, reason: "verification_failed" };
  }
  const dep = await db.deposit.findUnique({ where: { txRef } });
  if (!dep) return { credited: false as const, reason: "deposit_not_found" };
  const paidCents = verification.amountETB !== undefined ? Math.round(verification.amountETB * 100) : dep.amountCents;
  if (paidCents !== dep.amountCents || (verification.currency && verification.currency.toUpperCase() !== "ETB")) {
    await logAudit({
      action: "FRAUD_FLAG",
      entity: "deposit",
      entityId: dep.id,
      details: { reason: "amount_or_currency_mismatch", paidCents, expectedCents: dep.amountCents, currency: verification.currency },
    });
    return { credited: false as const, reason: "amount_mismatch" };
  }
  const result = await creditDepositIdempotent(txRef, verification.providerRef);
  if (result.credited) await fraudCheckDepositVelocity(result.deposit.userId);
  return result;
}
