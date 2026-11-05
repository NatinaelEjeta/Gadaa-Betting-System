import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, requireAuth } from "@/lib/api";

/** GET /api/admin/withdrawals?status= — withdrawal approval queue. */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req, ["FINANCE", "ADMIN", "SUPER_ADMIN"]);
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "PENDING";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));

  const where = status === "ALL" ? {} : { status };
  const [total, rows] = await Promise.all([
    db.withdrawal.count({ where }),
    db.withdrawal.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * 15,
      take: 15,
      include: {
        user: { select: { id: true, phone: true, fullName: true, wallet: { select: { balanceCents: true } } } },
      },
    }),
  ]);

  return ok({
    withdrawals: rows.map((w) => ({
      id: w.id,
      amountCents: w.amountCents,
      feeCents: w.feeCents,
      method: w.method,
      accountName: w.accountName,
      accountNumber: w.accountNumber,
      bankName: w.bankName,
      status: w.status,
      adminNote: w.adminNote,
      createdAt: w.createdAt.toISOString(),
      processedAt: w.processedAt?.toISOString() ?? null,
      user: w.user,
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / 15)),
  });
});
