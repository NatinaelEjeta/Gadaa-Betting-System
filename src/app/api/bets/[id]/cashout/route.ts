import { NextRequest } from "next/server";
import { ok, route, fail, requireAuth, assertSameOrigin } from "@/lib/api";
import { getCashoutOffer, cashoutBet } from "@/lib/settlement";
import { db } from "@/lib/db";
import { betInclude } from "@/lib/serialize";
import { mapBet } from "@/lib/serialize";

/** GET /api/bets/:id/cashout — current cashout offer (null when unavailable). */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireAuth(req);
  const { id } = await ctx.params;
  const offer = await getCashoutOffer(id, session.uid);
  return ok({ offerCents: offer?.offerCents ?? null });
});

/** POST /api/bets/:id/cashout — accept the cashout. */
export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const { id } = await ctx.params;

  try {
    const { offerCents } = await cashoutBet(id, session.uid);
    const bet = await db.bet.findUniqueOrThrow({ where: { id }, include: betInclude });
    return ok({ offerCents, bet: mapBet(bet) });
  } catch (err) {
    return fail("Cashout is not available for this bet", 409, "CASHOUT_UNAVAILABLE");
  }
});
