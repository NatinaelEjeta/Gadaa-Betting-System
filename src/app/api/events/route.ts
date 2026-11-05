import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route } from "@/lib/api";
import { mapEvent, EventDTO } from "@/lib/serialize";

/**
 * GET /api/events?sport=&league=&status=&featured=&q=&page=
 * status: LIVE | SCHEDULED | FINISHED (default SCHEDULED, LIVE first for live)
 */
export const GET = route(async (req: NextRequest) => {
  const url = new URL(req.url);
  const sport = url.searchParams.get("sport") ?? undefined;
  const leagueId = url.searchParams.get("league") ?? undefined;
  const status = (url.searchParams.get("status") ?? "SCHEDULED").toUpperCase();
  const featured = url.searchParams.get("featured") === "1";
  const q = url.searchParams.get("q")?.trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(50, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10));

  const now = new Date();
  const where = {
    ...(sport ? { sport: { key: sport } } : {}),
    ...(leagueId ? { leagueId } : {}),
    ...(featured ? { featured: true } : {}),
    ...(q
      ? {
          OR: [
            { homeTeam: { name: { contains: q } } },
            { awayTeam: { name: { contains: q } } },
            { league: { name: { contains: q } } },
          ],
        }
      : {}),
    ...(status === "LIVE"
      ? { status: "LIVE" as const }
      : status === "FINISHED"
        ? { status: "FINISHED" as const }
        : { status: "SCHEDULED" as const, startTime: { gte: now } }),
  };

  const [total, events] = await Promise.all([
    db.event.count({ where }),
    db.event.findMany({
      where,
      orderBy: status === "FINISHED" ? { startTime: "desc" } : { startTime: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        sport: true,
        league: true,
        homeTeam: true,
        awayTeam: true,
        markets: {
          where: { status: { not: "SETTLED" } },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: { selections: { orderBy: { id: "asc" } } },
        },
      },
    }),
  ]);

  const dtos: EventDTO[] = events.map(mapEvent);
  return ok({
    events: dtos,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});
