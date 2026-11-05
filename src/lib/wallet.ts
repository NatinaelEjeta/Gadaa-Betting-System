import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";

/**
 * Double-entry wallet ledger.
 *
 * Rules enforced here:
 *  1. Every balance change writes a LedgerEntry row with before/after balances
 *     and the counter-account (HOUSE_MAIN, PROMO_BONUS, ...) — auditable money.
 *  2. Debits can never take the balance below zero (checked inside the same
 *     transaction as the write — no double spending).
 *  3. Optimistic concurrency: wallet rows carry a `version` token; concurrent
 *     mutations retry. On PostgreSQL additionally use SELECT ... FOR UPDATE
 *     inside the transaction for strict row locking (see README).
 *  4. Callers may pass their own transaction client so wallet changes compose
 *     atomically with bets, deposits, settlements, etc.
 */

type TxClient = Prisma.TransactionClient;

export type LedgerType =
  | "DEPOSIT"
  | "WITHDRAWAL_HOLD"
  | "WITHDRAWAL_SETTLE"
  | "WITHDRAWAL_REFUND"
  | "BET_STAKE"
  | "BET_WIN"
  | "BET_REFUND"
  | "CASHOUT"
  | "BONUS"
  | "MANUAL_ADJUST";

export const COUNTER_ACCOUNTS = {
  HOUSE_MAIN: "HOUSE_MAIN",
  HOUSE_PENDING_WITHDRAWAL: "HOUSE_PENDING_WITHDRAWAL",
  PROMO_BONUS: "PROMO_BONUS",
  PAYMENTS_CHAPA: "PAYMENTS_CHAPA",
} as const;

export interface TxRowInput {
  type: string; // DEPOSIT | WITHDRAWAL | BET | WIN | REFUND | CASHOUT | BONUS | ADJUSTMENT
  status: string; // PENDING | SUCCESS | FAILED | REFUNDED
  amountCents?: number; // defaults to |delta|
  reference?: string;
  provider?: string;
  description?: string;
  metaJson?: string;
}

export interface WalletMutation {
  userId: string;
  /** +credit / -debit on the real (stakeable) balance, in cents. */
  deltaCents: number;
  /** Informational bonus ledger adjustment (tracked separately). */
  bonusDeltaCents?: number;
  /** Move funds in/out of the "locked" bucket (withdrawal holds). */
  lockedDeltaCents?: number;
  entryType: LedgerType;
  counterAccount: string;
  refType?: string;
  refId?: string;
  description?: string;
  /** Optionally also write a Transaction row in the same atomic operation. */
  txRow?: TxRowInput;
}

export class ConcurrencyError extends Error {
  constructor() {
    super("wallet version conflict");
  }
}

/**
 * Apply a batch of wallet mutations inside an existing transaction.
 * Throws ApiError(INSUFFICIENT_FUNDS) if a debit would go negative.
 */
export async function applyMutations(tx: TxClient, mutations: WalletMutation[]) {
  const results: Array<{ walletId: string; balanceCents: number; lockedCents: number; bonusCents: number }> = [];
  for (const m of mutations) {
    const wallet = await tx.wallet.findUnique({ where: { userId: m.userId } });
    if (!wallet) throw new ApiError("Wallet not found", 404, "WALLET_NOT_FOUND");

    const balanceAfter = wallet.balanceCents + m.deltaCents;
    const lockedAfter = wallet.lockedCents + (m.lockedDeltaCents ?? 0);
    const bonusAfter = wallet.bonusCents + (m.bonusDeltaCents ?? 0);

    if (m.deltaCents < 0 && balanceAfter < 0) {
      throw new ApiError("Insufficient balance", 400, "INSUFFICIENT_FUNDS");
    }
    if (lockedAfter < 0) {
      throw new ApiError("Invalid locked balance operation", 400, "INVALID_WALLET_OP");
    }

    // Optimistic concurrency: only update if version hasn't moved.
    const updated = await tx.wallet.updateMany({
      where: { id: wallet.id, version: wallet.version },
      data: {
        balanceCents: { increment: m.deltaCents },
        lockedCents: { increment: m.lockedDeltaCents ?? 0 },
        bonusCents: { increment: m.bonusDeltaCents ?? 0 },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw new ConcurrencyError();

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        entryType: m.entryType,
        direction: m.deltaCents >= 0 && (m.lockedDeltaCents ?? 0) <= 0 ? "CREDIT" : "DEBIT",
        amountCents: Math.abs(m.deltaCents),
        balanceBeforeCents: wallet.balanceCents,
        balanceAfterCents: balanceAfter,
        counterAccount: m.counterAccount,
        refType: m.refType,
        refId: m.refId,
        description: m.description,
      },
    });

    if (m.txRow) {
      await tx.transaction.create({
        data: {
          userId: m.userId,
          type: m.txRow.type,
          status: m.txRow.status,
          amountCents: m.txRow.amountCents ?? Math.abs(m.deltaCents),
          reference: m.txRow.reference,
          provider: m.txRow.provider,
          description: m.txRow.description,
          metaJson: m.txRow.metaJson,
        },
      });
    }

    results.push({
      walletId: wallet.id,
      balanceCents: balanceAfter,
      lockedCents: lockedAfter,
      bonusCents: bonusAfter,
    });
  }
  return results;
}

/**
 * Standalone mutations in their own transaction with bounded retries on
 * version conflicts (SQLite/Postgres safe).
 */
export async function mutateWallet(mutations: WalletMutation[]) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction((tx) => applyMutations(tx, mutations), {
        timeout: 15_000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (err instanceof ConcurrencyError && attempt < 3) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1) + Math.random() * 40));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export async function getWallet(userId: string) {
  return db.wallet.findUnique({ where: { userId } });
}
