import { ProviderMarket } from "@/lib/sports/types";

/**
 * Standard market templates shared by the mock provider, the seed script and
 * admin event creation. Settlement outcomes are computed in lib/settlement.ts
 * from (marketKey, line, selectionName) against the final score.
 */

export interface MarketTemplateInput {
  /** 1X2 base odds (decimal). */
  home: number;
  draw: number;
  away: number;
  /** total-goals line for Over/Under (default 2.5). */
  ouLine?: number;
  /** handicap applied to the HOME side (default -1). */
  handicapLine?: number;
  /** include money-line only (no draw) e.g. basketball. */
  noDraw?: boolean;
  /** include goal markets (O/U, BTTS) — football only. */
  includeGoals?: boolean;
}

function norm(margin: number, ...odds: number[]): number[] {
  // normalize implied probabilities and add bookmaker margin
  const implied = odds.map((o) => 1 / Math.max(1.01, o));
  const sum = implied.reduce((a, b) => a + b, 0);
  return odds.map((_, i) => Math.max(1.01, Math.round(((1 / implied[i]) * sum * margin) * 100) / 100));
}

export function buildStandardMarkets(input: MarketTemplateInput): ProviderMarket[] {
  const markets: ProviderMarket[] = [];
  const ouLine = input.ouLine ?? 2.5;
  const hcpLine = input.handicapLine ?? -1;
  const includeGoals = input.includeGoals ?? true;

  if (input.noDraw) {
    const [h, a] = norm(1.06, input.home, input.away);
    markets.push({
      key: "MONEY_LINE",
      name: "Match Result",
      sortOrder: 10,
      selections: [
        { name: "HOME", odds: h },
        { name: "AWAY", odds: a },
      ],
    });
  } else {
    const [h, d, a] = norm(1.06, input.home, input.draw, input.away);
    markets.push({
      key: "1X2",
      name: "Match Winner",
      sortOrder: 10,
      selections: [
        { name: "1", odds: h },
        { name: "X", odds: d },
        { name: "2", odds: a },
      ],
    });
    // Double chance derived from 1X2 probabilities
    const dc = norm(1.08, 1 / (1 / h + 1 / d), 1 / (1 / h + 1 / a), 1 / (1 / d + 1 / a));
    markets.push(
      {
        key: "DOUBLE_CHANCE_1X",
        name: "Double Chance 1X",
        sortOrder: 20,
        selections: [{ name: "1X", odds: dc[0] }],
      },
      {
        key: "DOUBLE_CHANCE_12",
        name: "Double Chance 12",
        sortOrder: 21,
        selections: [{ name: "12", odds: dc[1] }],
      },
      {
        key: "DOUBLE_CHANCE_X2",
        name: "Double Chance X2",
        sortOrder: 22,
        selections: [{ name: "X2", odds: dc[2] }],
      }
    );
  }

  if (includeGoals) {
    const overProb = 0.52;
    const [over, under] = norm(1.07, 1 / overProb, 1 / (1 - overProb));
    markets.push({
      key: `OVER_UNDER_${ouLine}`,
      name: `Over/Under ${ouLine}`,
      line: ouLine,
      sortOrder: 30,
      selections: [
        { name: "OVER", odds: over },
        { name: "UNDER", odds: under },
      ],
    });
    const [yes, no] = norm(1.07, 1.9, 1.9);
    markets.push({
      key: "BTTS",
      name: "Both Teams to Score",
      sortOrder: 40,
      selections: [
        { name: "YES", odds: yes },
        { name: "NO", odds: no },
      ],
    });
    // Asian-style handicap on the home side: HOME wins the market if home+line > away
    const [hcHome, hcAway] = norm(1.07, input.home * 0.82, Math.max(1.6, input.away * 0.62));
    markets.push({
      key: `HANDICAP_${hcpLine}`,
      name: `Handicap ${hcpLine > 0 ? "+" : ""}${hcpLine}`,
      line: hcpLine,
      sortOrder: 50,
      selections: [
        { name: "HOME", odds: hcHome },
        { name: "AWAY", odds: hcAway },
      ],
    });
  }

  return markets;
}
