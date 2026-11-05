import {
  SportsDataProvider,
  ProviderLeague,
  ProviderTeam,
  ProviderFixture,
  ProviderMarket,
} from "@/lib/sports/types";
import { RequestBudget, fetchWithBackoff } from "@/lib/sports/budget";

/**
 * API-Football (api-sports.io) implementation of SportsDataProvider.
 *
 * Rate-limit policy (free plan: 100 req/day, 10 req/min):
 *  - client-side budget enforced BEFORE each call (RequestBudget)
 *  - `x-ratelimit-requests-left` / `x-ratelimit-requests-limit` headers read
 *    after every call to keep our accounting honest
 *  - 429/5xx retried with exponential backoff + jitter
 *
 * API keys live in environment variables only (API_FOOTBALL_KEY).
 */

const API_BASE = process.env.API_FOOTBALL_BASE_URL ?? "https://v3.football.api-sports.io";
const DAILY_BUDGET = Number.parseInt(process.env.API_FOOTBALL_DAILY_BUDGET ?? "100", 10);
const PER_MINUTE = Number.parseInt(process.env.API_FOOTBALL_PER_MINUTE ?? "10", 10);

/** Popular league ids we sync (EPL, La Liga, Serie A, Bundesliga, Ligue 1). */
const LEAGUE_IDS = (process.env.API_FOOTBALL_LEAGUE_IDS ?? "39,140,135,78,61").split(",");

interface ApiSportsResponse<T> {
  response: T[];
  errors?: unknown;
}

interface RawFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string; elapsed?: number };
  };
  league: { id: number; name: string; country: string; season: number };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
}

interface RawOddsResponse {
  fixture: { id: number };
  bookmakers: Array<{
    id: number;
    name: string;
    bets: Array<{
      id: number;
      name: string;
      values: Array<{ value: string; odd: string }>;
    }>;
  }>;
}

export class ApiFootballProvider implements SportsDataProvider {
  readonly name = "api-football" as const;
  private key: string;
  private budget: RequestBudget;

  constructor(key: string) {
    this.key = key;
    this.budget = new RequestBudget(DAILY_BUDGET, PER_MINUTE);
  }

  budgetStats() {
    return this.budget.stats();
  }

  private async api<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetchWithBackoff(
      url.toString(),
      { headers: { "x-apisports-key": this.key } },
      {
        budget: this.budget,
        headersCb: (headers) => {
          // read the provider's own rate-limit accounting
          this.budget.updateFromHeaders(
            headers.get("x-ratelimit-requests-left"),
            headers.get("x-ratelimit-requests-limit")
          );
        },
      }
    );

    if (!res.ok) throw new Error(`API-Football ${path} failed: ${res.status}`);
    const json = (await res.json()) as ApiSportsResponse<T>;
    if (json.errors && Object.keys(json.errors).length > 0) {
      throw new Error(`API-Football error: ${JSON.stringify(json.errors)}`);
    }
    return json.response ?? [];
  }

  async fetchLeagues(_sportKey: string): Promise<ProviderLeague[]> {
    const season = String(new Date().getUTCFullYear());
    const rows = await this.api<{ league: { id: number; name: string; country: string }; seasons: Array<{ year: number }> }>(
      "/leagues",
      { current: "true" }
    );
    return rows
      .filter((r) => LEAGUE_IDS.includes(String(r.league.id)))
      .map((r) => ({
        externalId: `af-league-${r.league.id}`,
        sportKey: "football",
        name: r.league.name,
        country: r.league.country,
        season,
      }));
  }

  async fetchTeams(sportKey: string): Promise<ProviderTeam[]> {
    if (sportKey !== "football") return [];
    const season = String(new Date().getUTCFullYear());
    const out: ProviderTeam[] = [];
    for (const leagueId of LEAGUE_IDS.slice(0, 3)) {
      try {
        const rows = await this.api<{ team: { id: number; name: string } }>("/teams", {
          league: leagueId,
          season,
        });
        for (const r of rows) {
          out.push({
            externalId: `af-team-${r.team.id}`,
            sportKey: "football",
            name: r.team.name,
            shortName: r.team.name.slice(0, 3).toUpperCase(),
          });
        }
      } catch (err) {
        console.error(`[api-football] teams fetch failed for league ${leagueId}:`, err);
      }
    }
    return out;
  }

  async fetchFixtures(): Promise<ProviderFixture[]> {
    const today = new Date();
    const dates = [today, new Date(today.getTime() + 86_400_000)];
    const out: ProviderFixture[] = [];
    for (const d of dates) {
      const dateStr = d.toISOString().slice(0, 10);
      try {
        const rows = await this.api<RawFixture>("/fixtures", { date: dateStr });
        for (const f of rows) {
          if (!LEAGUE_IDS.includes(String(f.league.id))) continue;
          const status = mapStatus(f.fixture.status.short);
          if (status === "FINISHED" && dateStr !== dates[0].toISOString().slice(0, 10)) continue;
          out.push(toProviderFixture(f));
        }
      } catch (err) {
        console.error("[api-football] fixtures fetch failed:", err);
      }
    }
    return out;
  }

  async fetchLiveUpdates(): Promise<ProviderFixture[]> {
    const rows = await this.api<RawFixture>("/fixtures", { live: "all" });
    return rows.filter((f) => LEAGUE_IDS.includes(String(f.league.id))).map(toProviderFixture);
  }

  async fetchOdds(eventExternalId: string): Promise<ProviderMarket[]> {
    const fixtureId = eventExternalId.replace("af-fixture-", "");
    const rows = await this.api<RawOddsResponse>("/odds", { fixture: fixtureId, bookmaker: "8" });
    const book = rows[0]?.bookmakers?.[0];
    if (!book) return [];
    const markets: ProviderMarket[] = [];
    for (const bet of book.bets) {
      if (bet.name === "Match Winner") {
        markets.push({
          key: "1X2",
          name: "Match Winner",
          sortOrder: 10,
          selections: bet.values.map((v) => ({ name: v.value, odds: Number(v.odd) })),
        });
      } else if (bet.name === "Goals Over/Under") {
        // first values line is the main line (2.5)
        markets.push({
          key: "OVER_UNDER_2_5",
          name: "Over/Under 2.5",
          line: 2.5,
          sortOrder: 30,
          selections: bet.values
            .filter((v) => v.value === "Over" || v.value === "Under")
            .map((v) => ({ name: v.value.toUpperCase(), odds: Number(v.odd) })),
        });
      } else if (bet.name === "Both Teams Score") {
        markets.push({
          key: "BTTS",
          name: "Both Teams to Score",
          sortOrder: 40,
          selections: bet.values.map((v) => ({ name: v.value.toUpperCase(), odds: Number(v.odd) })),
        });
      } else if (bet.name === "Double Chance") {
        const keyMap: Record<string, string> = { "Home/Draw": "DOUBLE_CHANCE_1X", "Home/Away": "DOUBLE_CHANCE_12", "Draw/Away": "DOUBLE_CHANCE_X2" };
        for (const v of bet.values) {
          const key = keyMap[v.value];
          if (key) {
            markets.push({
              key,
              name: `Double Chance ${v.value.replace("/", "")}`,
              sortOrder: 20,
              selections: [{ name: key.replace("DOUBLE_CHANCE_", ""), odds: Number(v.odd) }],
            });
          }
        }
      }
    }
    return markets;
  }
}

function mapStatus(short: string): ProviderFixture["status"] {
  if (["NS", "PST", "CANC", "TBD"].includes(short)) return "SCHEDULED";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(short)) return "LIVE";
  return "FINISHED"; // FT, AET, PEN, ABD, SUSP, INT
}

function toProviderFixture(f: RawFixture): ProviderFixture {
  const status = mapStatus(f.fixture.status.short);
  return {
    externalId: `af-fixture-${f.fixture.id}`,
    sportKey: "football",
    leagueExternalId: `af-league-${f.league.id}`,
    homeTeamExternalId: `af-team-${f.teams.home.id}`,
    awayTeamExternalId: `af-team-${f.teams.away.id}`,
    startTime: f.fixture.date,
    status,
    minute: f.fixture.status.elapsed ?? undefined,
    homeScore: status === "SCHEDULED" ? undefined : (f.goals.home ?? 0),
    awayScore: status === "SCHEDULED" ? undefined : (f.goals.away ?? 0),
    featured: false,
  };
}
