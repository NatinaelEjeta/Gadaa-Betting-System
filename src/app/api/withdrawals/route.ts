import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, route, readJson, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { withdrawalSchema } from "@/lib/validation";
import { requestWithdrawal, approveWithdrawal } from "@/lib/payments";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { hashCode, safeEqual } from "@/lib/withdraw-otp";
import { logAudit } from "@/lib/audit";

/** GET /api/withdrawals - my withdrawal requests. */
export const GET = route(async (req: NextRequest) => {
  const session = await requireAuth(req);
  const rows = await db.withdrawal.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
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
    })),
  });
});

/**
 * POST /api/withdrawals - request a withdrawal. Requires the SMS code sent by
 * POST /api/withdrawals/code. At or below the approval limit it is paid
 * automatically; above it, it waits for admin/finance approval.
 */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const body = (await readJson(req)) as Record<string, unknown>;
  const { otp, ...rest } = body;
  const data = withdrawalSchema.parse(rest);

  const smsRequired = process.env.NEXT_PUBLIC_WITHDRAW_SMS !== "false";
  if (smsRequired) {
  const code = typeof otp === "string" ? otp.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    return fail("Enter the 6-digit code sent to your phone", 400, "OTP_REQUIRED");
  }

  const user = await db.user.findUnique({ where: { id: session.uid } });
  if (!user) return fail("Account not found", 404, "NOT_FOUND");

  if (rateLimit(`wd-verify:${user.id}`, 5, 15 * 60_000).allowed === false) {
    return fail("Too many attempts. Try again in 15 minutes.", 429, "RATE_LIMITED");
  }

  const row = await db.otpCode.findFirst({
    where: {
      phone: user.phone,
      purpose: `WITHDRAWAL:${data.amountCents}`,
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!row || !safeEqual(row.code, hashCode(code))) {
    await logAudit({
      actorId: user.id,
      action: "WITHDRAWAL_OTP_FAILED",
      entity: "user",
      entityId: user.id,
      ip: clientIp(req),
      details: { amountCents: data.amountCents },
    });
    return fail("Invalid or expired code", 400, "INVALID_OTP");
  }
  const claimed = await db.otpCode.updateMany({ where: { id: row.id, used: false }, data: { used: true } });
  if (claimed.count !== 1) return fail("Invalid or expired code", 400, "INVALID_OTP");
  }

  const result = await requestWithdrawal({ id: session.uid }, data);
  const withdrawalId = result.withdrawal.id;
  await logAudit({
    actorId: session.uid,
    action: "WITHDRAWAL_REQUEST",
    entity: "withdrawal",
    entityId: withdrawalId,
    ip: clientIp(req),
    details: { amountCents: data.amountCents, method: data.method, otpVerified: true },
  });

  const settings = await getSettings();
  let status: string = result.withdrawal.status;
  let note: string | null = null;

  if (data.amountCents <= settings.withdrawalApprovalThresholdCents) {
    try {
      await approveWithdrawal(
        { id: session.uid, phone: session.phone },
        withdrawalId,
        "Auto-approved: under approval limit"
      );
      await logAudit({
        actorId: session.uid,
        action: "WITHDRAWAL_AUTO_APPROVED",
        entity: "withdrawal",
        entityId: withdrawalId,
        ip: clientIp(req),
        details: { amountCents: data.amountCents },
      });
    } catch (err) {
      await logAudit({
        actorId: session.uid,
        action: "WITHDRAWAL_AUTO_APPROVE_FAILED",
        entity: "withdrawal",
        entityId: withdrawalId,
        ip: clientIp(req),
        details: { error: err instanceof Error ? err.message : "unknown" },
      });
    }
    const fresh = await db.withdrawal.findUnique({ where: { id: withdrawalId } });
    status = fresh?.status ?? status;
    note = fresh?.adminNote ?? null;
  } else {
    await logAudit({
      actorId: session.uid,
      action: "WITHDRAWAL_SENT_FOR_APPROVAL",
      entity: "withdrawal",
      entityId: withdrawalId,
      ip: clientIp(req),
      details: { amountCents: data.amountCents },
    });
  }

  return ok({ id: withdrawalId, status, note, balanceCents: result.balance });
});