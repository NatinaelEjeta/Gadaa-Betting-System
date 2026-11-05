import { NextRequest } from "next/server";
import { ok, route, readJson, fail, requireAuth, assertSameOrigin } from "@/lib/api";
import { adminForceSettleBet } from "@/lib/bets";

/** POST /api/admin/bets/:id/settle — manual override (WON / LOST / VOID). */
export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const body = await readJson<{ outcome: "WON" | "LOST" | "VOID"; payoutCents?: number }>(req);

  if (!["WON", "LOST", "VOID"].includes(body.outcome)) {
    return fail("Invalid outcome", 422, "VALIDATION_ERROR");
  }
  await adminForceSettleBet({ id: session.uid, phone: session.phone }, id, body.outcome, body.payoutCents);
  return ok({ settled: true, outcome: body.outcome });
});
