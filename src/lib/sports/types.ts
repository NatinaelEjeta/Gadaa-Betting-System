/**
 * SportsDataProvider — swappable sports data abstraction.
 * Users never call a provider directly: the worker syncs provider data into
 * our own database/cache and pushes it to clients over WebSocket.
 */

export type FixtureStatus = "SCHEDULED" | "LIVE" | "FINISHED";

export interface ProviderLeague {
  externalId: string;
  sportKey: string;
  name: string;
  country?: string;
  season?: string;
}

export interface ProviderTeam {
  externalId: string;
  sportKey: string;
  name: string;
  shortName?: string;
}

export interface ProviderSelection {
  name: string;
  odds: number;
}

export interface ProviderMarket {
  key: string; // 1X2 | DOUBLE_CHANCE_1X | OVER_UNDER_2_5 | BTTS | HANDICAP_-1 | MONEY_LINE ...
  name: string;
  line?: number;
  sortOrder: number;
  selections: ProviderSelection[];
}

export interface ProviderMatchEvent {
  type: "GOAL" | "RED_CARD";
  minute: number;
  team: "home" | "away";
}

export interface ProviderFixture {
  externalId: string;
  sportKey: string;
  leagueExternalId: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  startTime: string;
  status: FixtureStatus;
  minute?: number;
  homeScore?: number;
  awayScore?: number;
  featured?: boolean;
  events?: ProviderMatchEvent[];
}

export interface SportsDataProvider {
  readonly name: "mock" | "api-football";
  fetchLeagues(sportKey: string): Promise<ProviderLeague[]>;
  fetchTeams(sportKey: string): Promise<ProviderTeam[]>;
  /** Fixtures for today + next 48h (prematch catalogue). */
  fetchFixtures(): Promise<ProviderFixture[]>;
  /** Live subset with score/minute/status + match events. */
  fetchLiveUpdates(): Promise<ProviderFixture[]>;
  /** Full market set with current odds for one event. */
  fetchOdds(eventExternalId: string): Promise<ProviderMarket[]>;
}
