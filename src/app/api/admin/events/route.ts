import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { adminEventCreateSchema } from "@/lib/validation";
import { buildStandardMarkets } from "@/lib/sports/markets";
import { logAudit } from "@/lib/audit";

/** GET /api/admin/events?status=&q=&page= — event management list. */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req, ["SUPPORT", "FINANCE", "ADMIN", "SUPER_ADMIN"]);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));

  const where = {
    ...(status && status !== "ALL" ? { status } : {}),
    ...(q
      ? {
          OR: [
            { homeTeam: { name: { contains: q } } },
            { awayTeam: { name: { contains: q } } },
            { league: { name: { contains: q } } },
          ],
        }
      : {}),
  };
  const [total, events] = await Promise.all([
    db.event.count({ where }),
    db.event.findMany({
      where,
      orderBy: { startTime: "desc" },
      skip: (page - 1) * 15,
      take: 15,
      include: {
        sport: true,
        league: true,
        homeTeam: true,
        awayTeam: true,
        markets: {
          orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
          include: { selections: { orderBy: { id: "asc" as const } } },
        },
      },
    }),
  ]);

  return ok({ events, total, page, totalPages: Math.max(1, Math.ceil(total / 15)) });
});

/** POST /api/admin/events — create a manual event with standard markets. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const data = adminEventCreateSchema.parse(await readJson(req));

  const sport = await db.sport.upsert({
    where: { key: data.sportKey },
    update: {},
    create: { key: data.sportKey, name: data.sportKey.charAt(0).toUpperCase() + data.sportKey.slice(1) },
  });
  const league = await db.league.upsert({
    where: { externalId: `manual-league-${data.leagueName.toLowerCase().replace(/\s+/g, "-")}` },
    update: { name: data.leagueName },
    create: {
      externalId: `manual-league-${data.leagueName.toLowerCase().replace(/\s+/g, "-")}`,
      sportId: sport.id,
      name: data.leagueName,
    },
  });
  const mkTeam = (name: string) =>
    db.team.upsert({
      where: { externalId: `manual-team-${name.toLowerCase().replace(/\s+/g, "-")}` },
      update: { name },
      create: { externalId: `manual-team-${name.toLowerCase().replace(/\s+/g, "-")}`, sportId: sport.id, name },
    });
  const [home, away] = await Promise.all([mkTeam(data.homeTeamName), mkTeam(data.awayTeamName)]);

  const event = await db.event.create({
    data: {
      sportId: sport.id,
      leagueId: league.id,
      homeTeamId: home.id,
      awayTeamId: away.id,
      startTime: new Date(data.startTime),
      featured: data.featured ?? false,
      provider: "manual",
    },
  });

  if (data.withStandardMarkets) {
    const isBasketball = data.sportKey === "basketball";
    const markets = buildStandardMarkets({
      home: 2.5,
      draw: 3.2,
      away: 2.9,
      noDraw: isBasketball,
      ouLine: isBasketball ? 218.5 : 2.5,
    });
    for (const m of markets) {
      await db.market.create({
        data: {
          eventId: event.id,
          key: m.key,
          name: m.name,
          line: m.line ?? null,
          sortOrder: m.sortOrder,
          selections: { create: m.selections.map((s) => ({ name: s.name, odds: s.odds })) },
        },
      });
    }
  }

  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: "EVENT_CREATE",
    entity: "event",
    entityId: event.id,
    ip: clientIp(req),
    details: { home: data.homeTeamName, away: data.awayTeamName },
  });

  return ok({ event: { id: event.id } }, { status: 201 });
});
