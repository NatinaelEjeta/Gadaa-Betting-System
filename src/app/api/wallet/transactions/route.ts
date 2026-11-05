import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, requireAuth } from "@/lib/api";

/** GET /api/wallet/transactions?type=&page= — paged transaction history. */
export const GET = route(async (req: NextRequest) => {
  const session = await requireAuth(req);
  const url = new URL(req.url);
  const type = url.searchParams.get("type"); // DEPOSIT | WITHDRAWAL | BET | WIN | REFUND | CASHOUT | BONUS
  const status = url.searchParams.get("status");
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = 20;

  const where = {
    userId: session.uid,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
  };
  const [total, rows] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return ok({
    transactions: rows.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      amountCents: t.amountCents,
      currency: t.currency,
      reference: t.reference,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});
