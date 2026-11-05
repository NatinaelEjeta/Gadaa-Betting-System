import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, route, readJson, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { placeBetSchema } from "@/lib/validation";
import { placeBet } from "@/lib/bets";
import { mapBet, betInclude } from "@/lib/serialize";

/** GET /api/bets?filter=OPEN|SETTLED|ALL&page= — my bets. */
export const GET = route(async (req: NextRequest) => {
  const session = await requireAuth(req);
  const url = new URL(req.url);
  const filter = (url.searchParams.get("filter") ?? "ALL").toUpperCase();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = 15;

  const statusFilter: Prisma.BetWhereInput["status"] =
    filter === "OPEN"
      ? { in: ["OPEN", "PENDING_ACCEPTANCE"] }
      : filter === "SETTLED"
        ? { in: ["WON", "LOST", "CASHED_OUT", "VOID"] }
        : undefined;
  const where: Prisma.BetWhereInput = { userId: session.uid, ...(statusFilter ? { status: statusFilter } : {}) };

  const [total, bets] = await Promise.all([
    db.bet.count({ where }),
    db.bet.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: betInclude,
    }),
  ]);

  const dtos = bets.map((b) => {
    const dto = mapBet(b);
    return {
      ...dto,
      legs: dto.legs.map((leg, i) => ({
        ...leg,
        eventStatus: b.legs[i].event.status,
        eventScore:
          b.legs[i].event.homeScore != null
            ? `${b.legs[i].event.homeScore}-${b.legs[i].event.awayScore}`
            : null,
      })),
    };
  });

  return ok({ bets: dtos, page, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

/** POST /api/bets — place a bet (single / accumulator / system). */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const input = placeBetSchema.parse(await readJson(req));

  const bet = await placeBet(
    { id: session.uid, phone: session.phone },
    {
      type: input.type,
      stakeCents: input.stakeCents,
      selectionIds: input.selectionIds,
      systemK: input.systemK,
      acceptOddsChange: input.acceptOddsChange,
    },
    clientIp(req)
  );

  const full = await db.bet.findUniqueOrThrow({ where: { id: bet.id }, include: betInclude });
  return ok({ bet: mapBet(full) }, { status: 201 });
});
