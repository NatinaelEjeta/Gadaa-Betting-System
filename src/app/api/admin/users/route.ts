import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, requireAuth } from "@/lib/api";

/** GET /api/admin/users?q=&status=&page= — user management list. */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req, ["SUPPORT", "FINANCE", "ADMIN", "SUPER_ADMIN"]);
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status");
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = 20;

  const where = {
    ...(q ? { OR: [{ phone: { contains: q } }, { fullName: { contains: q } }] } : {}),
    ...(status ? { status } : {}),
  };

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        wallet: true,
        kycDocuments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
        _count: { select: { bets: true } },
      },
    }),
  ]);

  // aggregate stakes per page of users
  const stakeAgg = await db.bet.groupBy({
    by: ["userId"],
    where: { userId: { in: users.map((u) => u.id) }, status: { in: ["OPEN", "WON", "LOST", "CASHED_OUT"] } },
    _sum: { stakeCents: true },
  });
  const stakeMap = new Map(stakeAgg.map((s) => [s.userId, s._sum.stakeCents ?? 0]));

  return ok({
    users: users.map((u) => ({
      id: u.id,
      phone: u.phone,
      fullName: u.fullName,
      role: u.role,
      status: u.status,
      balanceCents: u.wallet?.balanceCents ?? 0,
      bonusCents: u.wallet?.bonusCents ?? 0,
      kycStatus: u.kycDocuments[0]?.status ?? "NONE",
      betsCount: u._count.bets,
      totalStakedCents: stakeMap.get(u.id) ?? 0,
      createdAt: u.createdAt.toISOString(),
    })),
    page,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});
