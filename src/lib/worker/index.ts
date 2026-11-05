import "server-only";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getProvider } from "@/lib/sports";
import { emitToRoom } from "@/lib/worker/realtime-client";
import { settleFinishedEvents } from "@/lib/settlement";
import { confirmPendingLiveBets } from "@/lib/bets";

/**
 * Background worker ("cron") — runs inside the Next.js nodejs runtime via
 * instrumentation.ts. Idempotent start (dev HMR safe).
 *
 * Jobs:
 *   fixturesSync : provider → DB (sports, leagues, teams, events)   [~5 min]
 *   livePoll     : score/minute/status/events + auto-suspend        [10 s]
 *   oddsSync     : refresh odds for open events + push changes      [20 s]
 *   liveAccept   : confirm/void live bets after the delay           [2 s]
 *   settle       : settle markets + bets for finished events        [30 s]
 *   marketReopen : reopen suspended markets after the goal pause    [5 s]
 */

let started = false;

export function startWorker() {
  const g = globalThis as unknown as { __gadaaWorkerStarted?: boolean };
  if (g.__gadaaWorkerStarted || started) return;
  started = true;
  g.__gadaaWorkerStarted = true;

  console.log("[worker] starting background jobs");
  void (async () => {
    await sleep(2500); // let the DB/prisma settle after boot
    await safeRun("fixturesSync", syncFixtures);
    await safeRun("oddsSync", syncOdds);
    await safeRun("livePoll", pollLive);

    const tick = async (name: string, ms: number, fn: () => Promise<unknown>) => {
      const loop = async () => {
        for (;;) {
          await sleep(ms);
          await safeRun(name, fn);
        }
      };
      void loop();
    };

    const settings = await getSettings();
    void tick("livePoll", (settings.livePollSeconds ?? 10) * 1000, pollLive);
    void tick("oddsSync", (settings.oddsSyncSeconds ?? 20) * 1000, syncOdds);
    void tick("fixturesSync", (settings.fixturesSyncMinutes ?? 5) * 60_000, syncFixtures);
    void tick("liveAccept", 2000, confirmLiveBets);
    void tick("settle", 30_000, runSettlement);
    void tick("marketReopen", 5000, reopenMarkets);
  })();
}

async function safeRun(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[worker:${name}]`, err);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Fixtures sync: provider → our DB (users only ever read our DB)
// ---------------------------------------------------------------------------

export async function syncFixtures() {
  const provider = await getProvider();
  const [leagues, teams, fixtures] = await Promise.all([
    provider.fetchLeagues("football").catch(() => []),
    provider.fetchTeams("football").catch(() => []),
    provider.fetchFixtures(),
  ]);
  const bLeagues = provider.name === "mock" ? await provider.fetchLeagues("basketball") : [];
  const bTeams = provider.name === "mock" ? await provider.fetchTeams("basketball") : [];

  const allLeagues = [...leagues, ...bLeagues];
  const allTeams = [...teams, ...bTeams];

  // sports
  const sportKeys = new Set(allLeagues.map((l) => l.sportKey));
  for (const key of sportKeys) {
    await db.sport.upsert({
      where: { key },
      update: {},
      create: { key, name: key === "football" ? "Football" : key === "basketball" ? "Basketball" : key },
    });
  }
  const sports = await db.sport.findMany();
  const sportByKey = new Map(sports.map((s) => [s.key, s]));

  // leagues
  for (const l of allLeagues) {
    const sport = sportByKey.get(l.sportKey);
    if (!sport) continue;
    await db.league.upsert({
      where: { externalId: l.externalId },
      update: { name: l.name, country: l.country, season: l.season },
      create: { externalId: l.externalId, sportId: sport.id, name: l.name, country: l.country, season: l.season },
    });
  }

  // teams
  for (const t of allTeams) {
    const sport = sportByKey.get(t.sportKey);
    if (!sport) continue;
    await db.team.upsert({
      where: { externalId: t.externalId },
      update: { name: t.name, shortName: t.shortName },
      create: { externalId: t.externalId, sportId: sport.id, name: t.name, shortName: t.shortName },
    });
  }

  // events (never downgrade a FINISHED event back to scheduled)
  let created = 0;
  for (const f of fixtures) {
    const league = await db.league.findUnique({ where: { externalId: f.leagueExternalId } });
    if (!league) continue;
    const home = await db.team.findUnique({ where: { externalId: f.homeTeamExternalId } });
    const away = await db.team.findUnique({ where: { externalId: f.awayTeamExternalId } });
    if (!home || !away) continue;

    const existing = await db.event.findUnique({ where: { externalId: f.externalId } });
    if (existing) {
      const isDowngrade =
        existing.status === "FINISHED" && (f.status === "SCHEDULED" || f.status === "LIVE");
      await db.event.update({
        where: { id: existing.id },
        data: {
          status: isDowngrade ? existing.status : f.status,
          startTime: new Date(f.startTime),
          minute: f.minute ?? (isDowngrade ? existing.minute : null),
          homeScore: f.homeScore ?? (isDowngrade ? existing.homeScore : null),
          awayScore: f.awayScore ?? (isDowngrade ? existing.awayScore : null),
          featured: f.featured ?? existing.featured,
        },
      });
    } else {
      await db.event.create({
        data: {
          sportId: league.sportId,
          leagueId: league.id,
          homeTeamId: home.id,
          awayTeamId: away.id,
          startTime: new Date(f.startTime),
          status: f.status,
          minute: f.minute ?? null,
          homeScore: f.homeScore ?? null,
          awayScore: f.awayScore ?? null,
          featured: f.featured ?? false,
          provider: provider.name,
          externalId: f.externalId,
        },
      });
      created++;
    }
  }
  if (created > 0) {
    emitToRoom("catalog", "catalog_update", { reason: "fixtures", created });
  }
}

// ---------------------------------------------------------------------------
// Odds sync: refresh odds for open (bettable) events and push deltas
// ---------------------------------------------------------------------------

export async function syncOdds() {
  const provider = await getProvider();
  const events = await db.event.findMany({
    where: { status: { in: ["SCHEDULED", "LIVE"] }, externalId: { not: null } },
    include: { markets: { include: { selections: true } } },
    orderBy: { startTime: "asc" },
    take: 40,
  });

  for (const event of events) {
    let markets;
    try {
      markets = await provider.fetchOdds(event.externalId!);
    } catch {
      continue; // budget exhausted / provider error — retry next tick
    }
    const changedPayload: Array<{ marketId: string; selections: Array<Record<string, unknown>> }> = [];

    for (const pm of markets) {
      let market = event.markets.find((m) => m.key === pm.key);
      if (!market) {
        market = await db.market.create({
          data: {
            eventId: event.id,
            key: pm.key,
            name: pm.name,
            line: pm.line ?? null,
            sortOrder: pm.sortOrder,
          },
          include: { selections: true },
        });
        event.markets.push(market);
      }
      if (market.status === "SETTLED") continue;

      for (const ps of pm.selections) {
        let sel = market.selections.find((s) => s.name === ps.name);
        if (!sel) {
          sel = await db.selection.create({
            data: { marketId: market.id, name: ps.name, odds: ps.odds },
          });
          market.selections.push(sel);
        }
        const newOdds = Math.round(ps.odds * 100) / 100;
        if (Math.abs(newOdds - sel.odds) >= 0.01) {
          const updated = await db.selection.update({
            where: { id: sel.id },
            data: { prevOdds: sel.odds, odds: newOdds },
          });
          sel = updated;
          changedPayload.push({
            marketId: market.id,
            selections: [{ selectionId: updated.id, odds: updated.odds, prevOdds: updated.prevOdds, status: updated.status }],
          });
        }
      }
    }

    if (changedPayload.length > 0) {
      const payload = { eventId: event.id, markets: changedPayload };
      emitToRoom(`event:${event.id}`, "odds_update", payload);
      if (event.status === "LIVE") emitToRoom("live", "odds_update", payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Live poll: score / minute / status; auto-suspend markets on goals & red cards
// ---------------------------------------------------------------------------

export async function pollLive() {
  const provider = await getProvider();
  const live = await provider.fetchLiveUpdates();

  for (const f of live) {
    const event = await db.event.findUnique({ where: { externalId: f.externalId } });
    if (!event) continue;

    const scoreChanged =
      (f.homeScore ?? 0) !== (event.homeScore ?? 0) || (f.awayScore ?? 0) !== (event.awayScore ?? 0);
    const becameFinished = f.status === "FINISHED" && event.status !== "FINISHED";
    const matchEvent = f.events && f.events.length > 0 ? f.events[f.events.length - 1] : null;

    await db.event.update({
      where: { id: event.id },
      data: {
        status: f.status,
        minute: f.minute ?? null,
        homeScore: f.homeScore ?? null,
        awayScore: f.awayScore ?? null,
      },
    });

    // Auto-suspend all markets on goals / red cards
    const settings = await getSettings();
    if ((scoreChanged || (matchEvent?.type === "RED_CARD" && !event.resultJson?.includes("redCardSuspended"))) && event.status === "LIVE") {
      await db.market.updateMany({
        where: { eventId: event.id, status: "OPEN" },
        data: { status: "SUSPENDED", suspendedAt: new Date() },
      });
      if (matchEvent?.type === "RED_CARD") {
        await db.event.update({
          where: { id: event.id },
          data: { resultJson: JSON.stringify({ redCardSuspended: matchEvent.minute }) },
        });
      }
    }

    const payload = {
      eventId: event.id,
      homeScore: f.homeScore ?? 0,
      awayScore: f.awayScore ?? 0,
      minute: f.minute ?? null,
      status: f.status,
      lastEvent: matchEvent ?? null,
      marketsSuspended: scoreChanged,
    };
    emitToRoom(`event:${event.id}`, "score_update", payload);
    emitToRoom("live", "score_update", payload);
    emitToRoom("catalog", "score_update", payload);

    if (becameFinished) {
      emitToRoom(`event:${event.id}`, "event_status", { eventId: event.id, status: "FINISHED" });
      emitToRoom("live", "event_status", { eventId: event.id, status: "FINISHED" });
    }
  }
}

// ---------------------------------------------------------------------------
// Reopen suspended markets after the goal pause
// ---------------------------------------------------------------------------

export async function reopenMarkets() {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - (settings.marketSuspendSeconds ?? 45) * 1000);
  const markets = await db.market.findMany({
    where: { status: "SUSPENDED", suspendedAt: { lt: cutoff }, event: { status: "LIVE" } },
    include: { selections: true },
    take: 80,
  });
  if (markets.length === 0) return;
  const byEvent = new Map<string, string[]>();
  for (const m of markets) {
    await db.market.update({
      where: { id: m.id },
      data: { status: "OPEN", suspendedAt: null },
    });
    const arr = byEvent.get(m.eventId) ?? [];
    arr.push(m.id);
    byEvent.set(m.eventId, arr);
  }
  for (const [eventId] of byEvent) {
    emitToRoom(`event:${eventId}`, "markets_reopened", { eventId });
    emitToRoom("live", "markets_reopened", { eventId });
    // refresh odds immediately after reopen
    await syncOddsForEvent(eventId);
  }
}

async function syncOddsForEvent(eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event?.externalId) return;
  const provider = await getProvider();
  const markets = await provider.fetchOdds(event.externalId).catch(() => []);
  for (const pm of markets) {
    const market = await db.market.findFirst({ where: { eventId, key: pm.key }, include: { selections: true } });
    if (!market || market.status === "SETTLED") continue;
    for (const ps of pm.selections) {
      const sel = market.selections.find((s) => s.name === ps.name);
      if (!sel) continue;
      const newOdds = Math.round(ps.odds * 100) / 100;
      if (Math.abs(newOdds - sel.odds) >= 0.01) {
        await db.selection.update({ where: { id: sel.id }, data: { prevOdds: sel.odds, odds: newOdds } });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Live bet acceptance + settlement
// ---------------------------------------------------------------------------

export async function confirmLiveBets() {
  const results = await confirmPendingLiveBets();
  for (const r of results) {
    emitToRoom(`user:${r.userId}`, "notify", { kind: r.kind, message: r.message });
  }
}

export async function runSettlement() {
  const notifications = await settleFinishedEvents(8);
  for (const n of notifications) {
    emitToRoom(`user:${n.userId}`, "notify", { kind: n.kind, message: n.message });
  }
  if (notifications.length > 0) {
    emitToRoom("catalog", "catalog_update", { reason: "settlement" });
  }
}
