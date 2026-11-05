import {
  SportsDataProvider,
  ProviderLeague,
  ProviderTeam,
  ProviderFixture,
  ProviderMarket,
  ProviderMatchEvent,
} from "@/lib/sports/types";
import { buildStandardMarkets } from "@/lib/sports/markets";

/**
 * Mock provider — deterministic football/basketball simulator.
 *
 * Design goals:
 *  - No API quota consumed; the whole sportsbook works offline.
 *  - Deterministic per fixture seed: the same fixture id always produces the
 *    same score timeline, so score/odds updates are consistent across polls.
 *  - Self-recycling: whenever a live match finishes, a new fixture is spawned
 *    so there are ALWAYS live events to bet on (great for demos).
 *  - The same wall-clock math drives fixtures: matches go LIVE when their
 *    kickoff time passes and FINISH after the match duration.
 */

const MATCH_DURATION_MIN = 100; // football: 90' + stoppage + buffer

// Fixture pool sizing
const LIVE_SLOTS = 4; // always ≥ 4 live events
const SOON_SLOTS = 3; // going live within minutes
const UPCOMING_SLOTS = 9; // next 48h
const KEEP_FINISHED = 12;

interface PoolTeam {
  id: string;
  name: string;
  short: string;
  attack: number; // 0.7 .. 1.3
}

interface LeagueDef {
  id: string;
  sportKey: string;
  name: string;
  country: string;
  teams: PoolTeam[];
}

/** Exported for the seed script so DB rows match provider external ids 1:1. */
export const LEAGUES: LeagueDef[] = [
  {
    id: "m-league-epl",
    sportKey: "football",
    name: "English Premier League",
    country: "England",
    teams: teams("epl", [
      ["Arsenal", 1.25], ["Chelsea", 1.05], ["Liverpool", 1.28], ["Manchester City", 1.3],
      ["Manchester United", 1.0], ["Tottenham", 1.02], ["Newcastle", 0.98], ["Aston Villa", 0.96],
      ["Brighton", 0.92], ["West Ham", 0.88], ["Everton", 0.85], ["Wolves", 0.82],
    ]),
  },
  {
    id: "m-league-eth",
    sportKey: "football",
    name: "Ethiopian Premier League",
    country: "Ethiopia",
    teams: teams("eth", [
      ["St. George", 1.22], ["Fasil Kenema", 1.1], ["Sidama Bunna", 1.02], ["Bahirdar Ketema", 1.0],
      ["Adama Ketema", 0.95], ["Hawassa Ketema", 0.94], ["Wolaitta Dicha", 0.9], ["Mekelakeya", 0.88],
      ["Ethiopia Nigd", 0.86], ["Arba Minch", 0.84],
    ]),
  },
  {
    id: "m-league-laliga",
    sportKey: "football",
    name: "La Liga",
    country: "Spain",
    teams: teams("ll", [
      ["Real Madrid", 1.32], ["Barcelona", 1.26], ["Atletico Madrid", 1.12], ["Real Sociedad", 1.0],
      ["Villarreal", 0.98], ["Real Betis", 0.95], ["Valencia", 0.9], ["Sevilla", 0.92],
    ]),
  },
  {
    id: "m-league-nba",
    sportKey: "basketball",
    name: "NBA",
    country: "USA",
    teams: teams("nba", [
      ["Boston Celtics", 1.24], ["Denver Nuggets", 1.2], ["LA Lakers", 1.1], ["Golden State", 1.08],
      ["Milwaukee Bucks", 1.12], ["Phoenix Suns", 1.05], ["Miami Heat", 1.02], ["Dallas Mavericks", 1.06],
    ]),
  },
];

function teams(prefix: string, defs: Array<[string, number]>): PoolTeam[] {
  return defs.map(([name, attack]) => ({
    id: `${prefix}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    name,
    short: name.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
    attack,
  }));
}

interface PoolFixture {
  externalId: string;
  leagueIdx: number;
  homeIdx: number;
  awayIdx: number;
  startTime: number; // epoch ms
  finished: boolean;
  redCard?: { minute: number; team: "home" | "away" } | null;
}

export class MockProvider implements SportsDataProvider {
  readonly name = "mock" as const;
  private counter = 1;
  private fixtures: PoolFixture[] = [];
  private initialized = false;

  private init() {
    if (this.initialized) return;
    this.initialized = true;
    const now = Date.now();
    const leagues = [0, 1, 2, 0, 1, 2, 3, 0, 2, 1, 3, 0, 1, 2, 3, 0];
    let li = 0;
    const spawn = (startOffsetMs: number) => {
      const leagueIdx = leagues[li % leagues.length];
      li++;
      this.fixtures.push(this.makeFixture(leagueIdx, now + startOffsetMs));
    };
    // Live right now (kickoff spread over the last hour)
    spawn(-62 * 60_000);
    spawn(-48 * 60_000);
    spawn(-31 * 60_000);
    spawn(-12 * 60_000);
    // Starting soon
    spawn(6 * 60_000);
    spawn(18 * 60_000);
    spawn(45 * 60_000);
    // Upcoming next 48h
    spawn(3 * 3_600_000);
    spawn(5 * 3_600_000);
    spawn(8 * 3_600_000);
    spawn(20 * 3_600_000);
    spawn(26 * 3_600_000);
    spawn(30 * 3_600_000);
    spawn(38 * 3_600_000);
    spawn(44 * 3_600_000);
    spawn(47 * 3_600_000);
  }

  private makeFixture(leagueIdx: number, startTime: number): PoolFixture {
    const league = LEAGUES[leagueIdx];
    const a = Math.floor(Math.random() * league.teams.length);
    let b = Math.floor(Math.random() * league.teams.length);
    if (b === a) b = (b + 1) % league.teams.length;
    const fixture: PoolFixture = {
      externalId: `mock-ev-${this.counter++}`,
      leagueIdx,
      homeIdx: a,
      awayIdx: b,
      startTime,
      finished: false,
    };
    // Pre-seed a possible red card (deterministic per fixture id)
    const rng = seededRng(fixture.externalId);
    fixture.redCard = rng() < 0.18 ? { minute: 20 + Math.floor(rng() * 70), team: rng() < 0.6 ? "away" : "home" } : null;
    return fixture;
  }

  private recycle() {
    const now = Date.now();
    for (const f of this.fixtures) {
      if (!f.finished && now >= f.startTime + MATCH_DURATION_MIN * 60_000) {
        f.finished = true;
      }
    }
    const liveCount = this.fixtures.filter(
      (f) => !f.finished && f.startTime <= now && now < f.startTime + MATCH_DURATION_MIN * 60_000
    ).length;
    // keep the live pool topped up
    for (let i = liveCount; i < LIVE_SLOTS; i++) {
      this.fixtures.push(this.makeFixture(Math.floor(Math.random() * LEAGUES.length), Date.now() + 2 * 60_000));
    }
    // prune old finished fixtures
    const finished = this.fixtures.filter((f) => f.finished).sort((x, y) => y.startTime - x.startTime);
    if (finished.length > KEEP_FINISHED) {
      const remove = new Set(finished.slice(KEEP_FINISHED).map((f) => f.externalId));
      this.fixtures = this.fixtures.filter((f) => !remove.has(f.externalId));
    }
  }

  async fetchLeagues(sportKey: string): Promise<ProviderLeague[]> {
    this.init();
    return LEAGUES.filter((l) => l.sportKey === sportKey).map((l) => ({
      externalId: l.id,
      sportKey: l.sportKey,
      name: l.name,
      country: l.country,
      season: "2025",
    }));
  }

  async fetchTeams(sportKey: string): Promise<ProviderTeam[]> {
    this.init();
    return LEAGUES.filter((l) => l.sportKey === sportKey).flatMap((l) =>
      l.teams.map((t) => ({ externalId: t.id, sportKey: l.sportKey, name: t.name, shortName: t.short }))
    );
  }

  private statusOf(f: PoolFixture): { status: ProviderFixture["status"]; minute?: number } {
    const now = Date.now();
    if (f.finished || now >= f.startTime + MATCH_DURATION_MIN * 60_000) return { status: "FINISHED" };
    if (now < f.startTime) return { status: "SCHEDULED" };
    const minute = Math.min(94, Math.floor((now - f.startTime) / 60_000));
    return { status: "LIVE", minute };
  }

  private toProviderFixture(f: PoolFixture, withEvents: boolean): ProviderFixture {
    const { status, minute } = this.statusOf(f);
    const league = LEAGUES[f.leagueIdx];
    const home = league.teams[f.homeIdx];
    const away = league.teams[f.awayIdx];
    const events: ProviderMatchEvent[] = [];
    let homeScore = 0;
    let awayScore = 0;
    if (status === "LIVE" || status === "FINISHED") {
      const m = status === "FINISHED" ? 94 : (minute ?? 0);
      // deterministic goal minutes from the fixture seed
      const rng = seededRng(f.externalId);
      const totalGoals = Math.floor(rng() * 5); // 0..4
      const goalMinutes = Array.from({ length: totalGoals }, () => 6 + Math.floor(rng() * 86)).sort((a, b) => a - b);
      const isBasketball = league.sportKey === "basketball";
      for (const gm of goalMinutes) {
        if (gm <= m) {
          const homeScores = rng() < (home.attack / (home.attack + away.attack));
          if (homeScores) homeScore += isBasketball ? 2 + 2 * Math.floor(rng() * 2) : 1;
          else awayScore += isBasketball ? 2 + 2 * Math.floor(rng() * 2) : 1;
          events.push({ type: "GOAL", minute: gm, team: homeScores ? "home" : "away" });
        }
      }
      if (f.redCard && f.redCard.minute <= m) {
        events.push({ type: "RED_CARD" as const, minute: f.redCard.minute, team: f.redCard.team });
      }
    }
    return {
      externalId: f.externalId,
      sportKey: league.sportKey,
      leagueExternalId: league.id,
      homeTeamExternalId: home.id,
      awayTeamExternalId: away.id,
      startTime: new Date(f.startTime).toISOString(),
      status,
      minute: status === "LIVE" ? minute : undefined,
      homeScore: status === "SCHEDULED" ? undefined : homeScore,
      awayScore: status === "SCHEDULED" ? undefined : awayScore,
      featured: f.externalId.endsWith("1") || f.externalId.endsWith("5"),
      events: withEvents ? events : undefined,
    };
  }

  async fetchFixtures(): Promise<ProviderFixture[]> {
    this.init();
    this.recycle();
    return this.fixtures
      .filter((f) => f.startTime < Date.now() + 49 * 3_600_000)
      .map((f) => this.toProviderFixture(f, false))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  async fetchLiveUpdates(): Promise<ProviderFixture[]> {
    this.init();
    this.recycle();
    const now = Date.now();
    return this.fixtures
      .filter((f) => !f.finished && f.startTime <= now && now < f.startTime + MATCH_DURATION_MIN * 60_000)
      .map((f) => this.toProviderFixture(f, true));
  }

  /**
   * Odds with live drift. Base odds derive from team attack ratings; a
   * deterministic time-based drift keeps odds moving so the UI shows live
   * updates. Football uses the full template; basketball is money-line+OU.
   */
  async fetchOdds(eventExternalId: string): Promise<ProviderMarket[]> {
    this.init();
    const f = this.fixtures.find((x) => x.externalId === eventExternalId);
    if (!f) return [];
    const league = LEAGUES[f.leagueIdx];
    const home = league.teams[f.homeIdx];
    const away = league.teams[f.awayIdx];
    const { status } = this.statusOf(f);

    // Base 1X2 from attack ratio with a seeded perturbation
    const rng = seededRng(f.externalId + ":odds");
    const strength = home.attack / (home.attack + away.attack);
    const drift = status === "LIVE" ? liveDrift(f.externalId) : 0.04 * Math.sin(Date.now() / 600_000 + rng() * 6);
    const pH = clamp(strength + 0.08 + drift, 0.12, 0.82);
    const pD = 0.24;
    const pA = clamp(1 - pH - pD * 0.9, 0.1, 0.8);

    const homeOdds = 1 / pH;
    const drawOdds = 1 / pD;
    const awayOdds = 1 / pA;

    const isBasketball = league.sportKey === "basketball";
    // Basketball: points line; football: goals line
    const ouLine = isBasketball ? 218.5 : 2.5;
    const markets = buildStandardMarkets({
      home: homeOdds,
      draw: drawOdds,
      away: awayOdds,
      ouLine,
      noDraw: isBasketball,
      includeGoals: true,
    });

    // LIVE matches: inflate odds of the trailing side (simple in-play model)
    if (status === "LIVE") {
      const fx = this.toProviderFixture(f, false);
      const hs = fx.homeScore ?? 0;
      const as = fx.awayScore ?? 0;
      const lead = hs - as;
      return markets.map((m) => ({
        ...m,
        selections: m.selections.map((s) => ({
          ...s,
          odds: Math.max(1.01, Math.round(s.odds * liveAdjust(m.key, s.name, lead) * 100) / 100),
        })),
      }));
    }
    return markets;
  }
}

function liveAdjust(marketKey: string, selection: string, lead: number): number {
  // lead > 0 → home winning: shorten home outcomes, lengthen away ones
  const sign = lead > 0 ? -1 : 1;
  const mag = Math.min(0.45, Math.abs(lead) * 0.18);
  const isHomeSide = selection === "1" || selection === "HOME" || selection.startsWith("1X") || selection === "OVER";
  if (marketKey.startsWith("OVER_UNDER") || marketKey === "BTTS") {
    return selection === "OVER" || selection === "YES" ? 1 + mag * 0.6 : Math.max(1.02, 1 - mag * 0.3);
  }
  if (selection === "X") return Math.max(1.05, 1 + mag * 0.8);
  return isHomeSide ? Math.max(1.02, 1 + sign * mag * -1) : 1 + mag;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Deterministic 0..1 PRNG from a string seed (mulberry32 over FNV-1a). */
export function seededRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Odds drift per 20s bucket — deterministic, smooth-ish movement. */
function liveDrift(eventId: string): number {
  const bucket = Math.floor(Date.now() / 20_000);
  const rng = seededRng(`${eventId}:${bucket}`);
  return (rng() - 0.5) * 0.12;
}
