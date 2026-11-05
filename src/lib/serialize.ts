import { Prisma } from "@prisma/client";

/**
 * Shared DTO shapes + Prisma→DTO mappers.
 * These define the exact API contract consumed by the frontend.
 */

// ---------------------------------------------------------------------------
// Sportsbook DTOs
// ---------------------------------------------------------------------------

export interface SelectionDTO {
  id: string;
  name: string;
  odds: number;
  prevOdds: number | null;
  status: "ACTIVE" | "SUSPENDED";
}

export interface MarketDTO {
  id: string;
  key: string;
  name: string;
  line: number | null;
  status: "OPEN" | "SUSPENDED" | "SETTLED";
  resultName: string | null;
  sortOrder: number;
  selections: SelectionDTO[];
}

export interface EventDTO {
  id: string;
  sportKey: string;
  sportName: string;
  leagueId: string;
  leagueName: string;
  homeTeam: { id: string; name: string; shortName: string | null };
  awayTeam: { id: string; name: string; shortName: string | null };
  startTime: string;
  status: "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  featured: boolean;
  markets: MarketDTO[];
}

const eventInclude = {
  sport: true,
  league: true,
  homeTeam: true,
  awayTeam: true,
  markets: {
    orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
    include: { selections: { orderBy: { id: "asc" as const } } },
  },
} satisfies Prisma.EventInclude;

export type EventWithRelations = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

export function mapSelection(s: {
  id: string;
  name: string;
  odds: number;
  prevOdds: number | null;
  status: string;
}): SelectionDTO {
  return {
    id: s.id,
    name: s.name,
    odds: s.odds,
    prevOdds: s.prevOdds,
    status: s.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
  };
}

export function mapMarket(m: {
  id: string;
  key: string;
  name: string;
  line: number | null;
  status: string;
  resultName: string | null;
  sortOrder: number;
  selections: Array<Parameters<typeof mapSelection>[0]>;
}): MarketDTO {
  return {
    id: m.id,
    key: m.key,
    name: m.name,
    line: m.line,
    status: m.status as MarketDTO["status"],
    resultName: m.resultName,
    sortOrder: m.sortOrder,
    selections: m.selections.map(mapSelection),
  };
}

export function mapEvent(e: EventWithRelations): EventDTO {
  return {
    id: e.id,
    sportKey: e.sport.key,
    sportName: e.sport.name,
    leagueId: e.league.id,
    leagueName: e.league.name,
    homeTeam: { id: e.homeTeam.id, name: e.homeTeam.name, shortName: e.homeTeam.shortName },
    awayTeam: { id: e.awayTeam.id, name: e.awayTeam.name, shortName: e.awayTeam.shortName },
    startTime: e.startTime.toISOString(),
    status: e.status as EventDTO["status"],
    minute: e.minute,
    homeScore: e.homeScore,
    awayScore: e.awayScore,
    featured: e.featured,
    markets: e.markets.map(mapMarket),
  };
}

// ---------------------------------------------------------------------------
// User / wallet / bets DTOs
// ---------------------------------------------------------------------------

export interface WalletDTO {
  balanceCents: number;
  bonusCents: number;
  lockedCents: number;
  currency: string;
}

export interface UserDTO {
  id: string;
  phone: string;
  fullName: string;
  role: string;
  status: string;
  phoneVerified: boolean;
  language: string;
  referralCode: string;
  createdAt: string;
  kycStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  limits: {
    dailyDepositLimitCents: number | null;
    dailyStakeLimitCents: number | null;
    lossLimitCents: number | null;
    coolingOffUntil: string | null;
  } | null;
  wallet?: WalletDTO;
}

export interface BetLegDTO {
  id: string;
  eventId: string;
  eventName: string;
  marketName: string;
  marketKey: string;
  selectionName: string;
  odds: number;
  line: number | null;
  status: "OPEN" | "WON" | "LOST" | "VOID";
  eventStatus?: string;
  eventScore?: string | null;
}

export interface BetDTO {
  id: string;
  type: "SINGLE" | "MULTIPLE" | "SYSTEM";
  systemK: number | null;
  comboCount: number;
  stakeCents: number;
  stakePerComboCents: number | null;
  totalOdds: number;
  potentialWinCents: number;
  status: "PENDING_ACCEPTANCE" | "OPEN" | "WON" | "LOST" | "CASHED_OUT" | "VOID" | "REJECTED";
  cashoutOfferCents: number | null;
  settledAt: string | null;
  createdAt: string;
  legs: BetLegDTO[];
}

export interface TxDTO {
  id: string;
  type: string;
  status: string;
  amountCents: number;
  currency: string;
  reference: string | null;
  description: string | null;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

type WalletWithFields = { balanceCents: number; bonusCents: number; lockedCents: number; currency: string };

export function mapWallet(w: WalletWithFields): WalletDTO {
  return {
    balanceCents: w.balanceCents,
    bonusCents: w.bonusCents,
    lockedCents: w.lockedCents,
    currency: w.currency,
  };
}

export function mapBet(b: BetWithLegs): BetDTO {
  return {
    id: b.id,
    type: b.type as BetDTO["type"],
    systemK: b.systemK,
    comboCount: b.comboCount,
    stakeCents: b.stakeCents,
    stakePerComboCents: b.stakePerComboCents,
    totalOdds: b.totalOdds,
    potentialWinCents: b.potentialWinCents,
    status: b.status as BetDTO["status"],
    cashoutOfferCents: b.cashoutOfferCents,
    settledAt: b.settledAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    legs: b.legs.map((l) => ({
      id: l.id,
      eventId: l.eventId,
      eventName: l.eventName,
      marketName: l.marketName,
      marketKey: l.marketKey,
      selectionName: l.selectionName,
      odds: l.oddsAtPlacement,
      line: l.line,
      status: l.status as BetLegDTO["status"],
    })),
  };
}

export const betInclude = {
  legs: { include: { event: { select: { status: true, homeScore: true, awayScore: true } } } },
} satisfies Prisma.BetInclude;

export type BetWithLegs = Prisma.BetGetPayload<{ include: typeof betInclude }>;

// ---------------------------------------------------------------------------
// Admin DTOs
// ---------------------------------------------------------------------------

export interface AdminUserRowDTO {
  id: string;
  phone: string;
  fullName: string;
  role: string;
  status: string;
  balanceCents: number;
  bonusCents: number;
  kycStatus: string;
  betsCount: number;
  totalStakedCents: number;
  createdAt: string;
}

export interface ReportDTO {
  days: Array<{
    date: string;
    depositsCents: number;
    withdrawalsCents: number;
    stakesCents: number;
    payoutsCents: number;
    ggrCents: number;
    betsCount: number;
    newUsers: number;
  }>;
  totals: {
    depositsCents: number;
    withdrawalsCents: number;
    stakesCents: number;
    payoutsCents: number;
    ggrCents: number;
    betsCount: number;
    usersCount: number;
    openBetsCount: number;
    pendingWithdrawalsCents: number;
    pendingKycCount: number;
  };
}
