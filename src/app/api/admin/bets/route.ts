import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { adminForceSettleBet } from "@/lib/bets";

/** GET /api/admin/bets?status=&userId=&page= — all bets (risk view). */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req, ["SUPPORT", "FINANCE", "ADMIN", "SUPER_ADMIN"]);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const userId = url.searchParams.get("userId");
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));

  const where = {
    ...(status && status !== "ALL" ? { status } : {}),
    ...(userId ? { userId } : {}),
  };
  const [total, bets] = await Promise.all([
    db.bet.count({ where }),
    db.bet.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 15,
      take: 15,
      include: {
        user: { select: { id: true, phone: true, fullName: true } },
        legs: true,
      },
    }),
  ]);

  return ok({
    bets: bets.map((b) => ({
      id: b.id,
      type: b.type,
      systemK: b.systemK,
      stakeCents: b.stakeCents,
      totalOdds: b.totalOdds,
      potentialWinCents: b.potentialWinCents,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
      settledAt: b.settledAt?.toISOString() ?? null,
      user: b.user,
      legs: b.legs.map((l) => ({
        eventName: l.eventName,
        marketName: l.marketName,
        selectionName: l.selectionName,
        odds: l.oddsAtPlacement,
        status: l.status,
      })),
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / 15)),
  });
});

