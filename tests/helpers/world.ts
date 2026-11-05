import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { mutateWallet, COUNTER_ACCOUNTS } from "@/lib/wallet";
import { settleMarketsForEvent } from "@/lib/settlement";
import type { Event, Market, Selection, User } from "@prisma/client";

/**
 * Shared test world: database reset + entity factories.
 *
 * Every test starts from an empty database (`resetDb` in beforeEach) and
 * builds exactly the entities it needs, so tests are order-independent and
 * read like the scenario they verify.
 */

export type EventWithMarkets = Event & {
  markets: (Market & { selections: Selection[] })[];
};

/** Delete every row, children before parents (SQLite FK-safe order). */
export async function resetDb(): Promise<void> {
  await db.betLeg.deleteMany();
  await db.bet.deleteMany();
  await db.ledgerEntry.deleteMany();
  await db.transaction.deleteMany();
  await db.deposit.deleteMany();
  await db.withdrawal.deleteMany();
  await db.selection.deleteMany();
  await db.market.deleteMany();
  await db.event.deleteMany();
  await db.team.deleteMany();
  await db.league.deleteMany();
  await db.sport.deleteMany();
  await db.notification.deleteMany();
  await db.auditLog.deleteMany();
  await db.bonusGrant.deleteMany();
  await db.referral.deleteMany();
  await db.bonus.deleteMany();
  await db.responsibleLimit.deleteMany();
  await db.selfExclusion.deleteMany();
  await db.otpCode.deleteMany();
  await db.passwordReset.deleteMany();
  await db.session.deleteMany();
  await db.setting.deleteMany();
  await db.wallet.deleteMany();
  await db.user.deleteMany();
}

/** Create a user + wallet, optionally topped up through the real ledger. */
export async function makeUser(opts: { initialBalanceCents?: number } = {}): Promise<User> {
  const phone = `+2519${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
  const user = await db.user.create({
    data: {
      phone,
      passwordHash: "vitest-not-a-real-hash",
      fullName: `Vitest User ${phone.slice(-4)}`,
      referralCode: `RC-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    },
  });
  await db.wallet.create({ data: { userId: user.id } });
  if (opts.initialBalanceCents && opts.initialBalanceCents > 0) {
    await mutateWallet([
      {
        userId: user.id,
        deltaCents: opts.initialBalanceCents,
        entryType: "DEPOSIT",
        counterAccount: COUNTER_ACCOUNTS.PAYMENTS_CHAPA,
        description: "Test top-up",
      },
    ]);
  }
  return user;
}

/** Snapshot of the wallet buckets after a test action. */
export async function balanceOf(userId: string) {
  const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
  return {
    balanceCents: wallet.balanceCents,
    bonusCents: wallet.bonusCents,
    lockedCents: wallet.lockedCents,
    version: wallet.version,
  };
}

/** All ledger rows of a user's wallet, oldest first. */
export async function ledgerOf(userId: string) {
  return db.ledgerEntry.findMany({
    where: { wallet: { userId } },
    orderBy: { createdAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Sportsbook fixtures
// ---------------------------------------------------------------------------

export interface MarketSpec {
  key: string;
  name?: string;
  line?: number | null;
  /** Force a market status/result up-front (manual settlement scenarios). */
  status?: string;
  resultName?: string | null;
  /** selection name → decimal odds */
  selections: Record<string, number>;
}

export interface EventSpec {
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  startTime?: Date;
  settledAt?: Date | null;
  markets: MarketSpec[];
}

/** A start time safely in the future (pre-match, not live). */
export const FUTURE_START = (): Date => new Date(Date.now() + 3_600_000);

/** Create a self-contained event (own sport/league/teams) with markets. */
export async function makeEvent(spec: EventSpec): Promise<EventWithMarkets> {
  const sport = await db.sport.create({
    data: { key: `football-${randomUUID().slice(0, 8)}`, name: "Football" },
  });
  const league = await db.league.create({
    data: { sportId: sport.id, name: "Ethiopian Premier League" },
  });
  const [home, away] = await Promise.all([
    db.team.create({ data: { sportId: sport.id, name: `Home FC ${randomUUID().slice(0, 4)}` } }),
    db.team.create({ data: { sportId: sport.id, name: `Away FC ${randomUUID().slice(0, 4)}` } }),
  ]);
  return db.event.create({
    data: {
      sportId: sport.id,
      leagueId: league.id,
      homeTeamId: home.id,
      awayTeamId: away.id,
      startTime: spec.startTime ?? FUTURE_START(),
      status: spec.status ?? "SCHEDULED",
      homeScore: spec.homeScore ?? null,
      awayScore: spec.awayScore ?? null,
      settledAt: spec.settledAt ?? null,
      markets: {
        create: spec.markets.map((m, i) => ({
          key: m.key,
          name: m.name ?? m.key,
          line: m.line ?? null,
          status: m.status ?? "OPEN",
          resultName: m.resultName ?? null,
          sortOrder: i,
          selections: {
            create: Object.entries(m.selections).map(([name, odds]) => ({ name, odds })),
          },
        })),
      },
    },
    include: { markets: { include: { selections: true } } },
  });
}

/**
 * The full book used by settlement tests: every market type the engine
 * supports, with stable odds so payout expectations are exact.
 */
export async function makeStandardEvent(spec: Partial<EventSpec> = {}): Promise<EventWithMarkets> {
  return makeEvent({
    status: "SCHEDULED",
    startTime: FUTURE_START(),
    markets: [
      { key: "1X2", name: "Match Result", selections: { "1": 2.0, X: 3.2, "2": 3.4 } },
      { key: "BTTS", name: "Both Teams To Score", selections: { YES: 1.8, NO: 2.0 } },
      { key: "OVER_UNDER_2_5", name: "Total Goals 2.5", line: 2.5, selections: { OVER: 1.9, UNDER: 1.9 } },
      { key: "OVER_UNDER_2_0", name: "Total Goals 2.0", line: 2.0, selections: { OVER: 1.75, UNDER: 2.05 } },
      { key: "DOUBLE_CHANCE_1X", name: "Double Chance 1X", selections: { "1X": 1.45 } },
      { key: "DOUBLE_CHANCE_12", name: "Double Chance 12", selections: { "12": 1.3 } },
      { key: "DOUBLE_CHANCE_X2", name: "Double Chance X2", selections: { "X2": 1.6 } },
      { key: "HANDICAP_-1", name: "Handicap -1", line: -1, selections: { HOME: 2.6, AWAY: 1.5 } },
    ],
    ...spec,
  });
}

/** Look up a fixture selection by market key + selection name. */
export function sel(event: EventWithMarkets, marketKey: string, selectionName: string): Selection {
  const market = event.markets.find((m) => m.key === marketKey);
  if (!market) throw new Error(`fixture error: market "${marketKey}" not found`);
  const selection = market.selections.find((s) => s.name === selectionName);
  if (!selection) throw new Error(`fixture error: selection "${marketKey}/${selectionName}" not found`);
  return selection;
}

/** Flip an event to FINISHED with a final score and settle all its markets. */
export async function finishEvent(eventId: string, homeScore: number, awayScore: number): Promise<void> {
  await db.event.update({
    where: { id: eventId },
    data: { status: "FINISHED", homeScore, awayScore },
  });
  await settleMarketsForEvent(eventId);
}
