import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, readJson, requireAuth, assertSameOrigin } from "@/lib/api";
import { verifyAndCreditDeposit } from "@/lib/payments";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ txRef: z.string().min(6).max(80).optional() });

/**
 * POST /api/deposits/verify - ask Chapa about this user's pending deposits and credit
 * the paid ones. Needed on localhost, where Chapa's webhook cannot reach the server.
 */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const { txRef } = schema.parse(await readJson(req));

  if (rateLimit(`dep-verify:${session.uid}`, 30, 60_000).allowed === false) {
    return fail("Too many requests", 429, "RATE_LIMITED");
  }

  const pending = await db.deposit.findMany({
    where: {
      userId: session.uid,
      status: "PENDING",
      ...(txRef ? { txRef } : { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } }),
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { txRef: true },
  });

  let credited = 0;
  for (const d of pending) {
    try {
      const r = await verifyAndCreditDeposit(d.txRef);
      if (r.credited) credited++;
    } catch {
      // not paid yet or Chapa unreachable: leave it pending
    }
  }
  return ok({ checked: pending.length, credited });
});