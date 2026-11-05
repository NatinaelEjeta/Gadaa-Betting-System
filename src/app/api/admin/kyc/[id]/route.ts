import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { kycReviewSchema } from "@/lib/validation";
import { logAudit, notify } from "@/lib/audit";

/** POST /api/admin/kyc/:id — approve or reject a KYC document. */
export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["SUPPORT", "ADMIN", "SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const data = kycReviewSchema.parse(await readJson(req));

  const doc = await db.kycDocument.findUnique({ where: { id } });
  if (!doc) return fail("Document not found", 404, "NOT_FOUND");
  if (doc.status !== "PENDING") return fail("Document already reviewed", 400, "ALREADY_REVIEWED");

  const status = data.action === "APPROVE" ? "APPROVED" : "REJECTED";
  await db.kycDocument.update({
    where: { id },
    data: { status, reviewerNote: data.note, reviewedById: session.uid, reviewedAt: new Date() },
  });

  await notify(
    doc.userId,
    "KYC",
    data.action === "APPROVE" ? "Identity verified" : "Verification rejected",
    data.action === "APPROVE"
      ? "Your ID has been approved. Enjoy full access to Gadaa Betting."
      : `Your document was rejected. ${data.note ?? "Please resubmit a clear photo."}`
  );

  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: `KYC_${data.action}`,
    entity: "kyc",
    entityId: id,
    ip: clientIp(req),
    details: { note: data.note, userId: doc.userId },
  });

  return ok({ status });
});
