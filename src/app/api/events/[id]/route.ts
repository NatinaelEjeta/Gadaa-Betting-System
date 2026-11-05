import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, fail } from "@/lib/api";
import { mapEvent } from "@/lib/serialize";

/** GET /api/events/:id — one event with all markets + selections. */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const event = await db.event.findUnique({
    where: { id },
    include: {
      sport: true,
      league: true,
      homeTeam: true,
      awayTeam: true,
      markets: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { selections: { orderBy: { id: "asc" } } },
      },
    },
  });
  if (!event) return fail("Event not found", 404, "NOT_FOUND");
  return ok({ event: mapEvent(event) });
});
