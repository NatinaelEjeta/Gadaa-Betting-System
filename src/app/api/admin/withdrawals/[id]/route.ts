import { NextRequest } from "next/server";
import { ok, route, readJson, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { withdrawalReviewSchema } from "@/lib/validation";
import { approveWithdrawal, rejectWithdrawal } from "@/lib/payments";

/** POST /api/admin/withdrawals/:id — approve (pays via Chapa) or reject (refunds hold). */
export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["FINANCE", "ADMIN", "SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const data = withdrawalReviewSchema.parse(await readJson(req));

  if (data.action === "APPROVE") {
    await approveWithdrawal({ id: session.uid, phone: session.phone }, id, data.note);
    return ok({ status: "PAID" });
  }
  await rejectWithdrawal({ id: session.uid, phone: session.phone }, id, data.note);
  return ok({ status: "REJECTED" });
});
