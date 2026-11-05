import { db } from "@/lib/db";
import { ok, route } from "@/lib/api";
import { cache } from "@/lib/cache";

/** GET /api/sports — sports with their leagues (cached 30s). */
export const GET = route(async () => {
  const data = await cache.withCache("sports-nav", 30_000, async () => {
    const sports = await db.sport.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        leagues: {
          where: { active: true },
          include: { _count: { select: { events: { where: { status: { in: ["SCHEDULED", "LIVE"] } } } } } },
        },
      },
    });
    return sports.map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      leagues: s.leagues.map((l) => ({
        id: l.id,
        name: l.name,
        country: l.country,
        eventsCount: l._count.events,
      })),
    }));
  });
  return ok(data);
});
