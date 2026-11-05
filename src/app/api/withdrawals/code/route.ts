import { NextRequest } from "next/server";
import { randomInt } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { sendSms } from "@/lib/sms";
import { hashCode, maskPhone } from "@/lib/withdraw-otp";
import { logAudit } from "@/lib/audit";

const schema = z.object({ amountCents: z.number().int().positive() });

/** POST /api/withdrawals/code - send a one-time code by SMS to the user's registered number. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const { amountCents } = schema.parse(await readJson(req));

  const user = await db.user.findUnique({ where: { id: session.uid } });
  if (!user) return fail("Account not found", 404, "NOT_FOUND");
  if (!user.phoneVerified) return fail("Verify your phone number first", 400, "PHONE_NOT_VERIFIED");

  const settings = await getSettings();
  if (amountCents < settings.minWithdrawalCents) {
    return fail("Amount is below the minimum withdrawal", 400, "BELOW_MINIMUM");
  }
  const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet || wallet.balanceCents < amountCents) {
    return fail("Insufficient balance", 400, "INSUFFICIENT_FUNDS");
  }

  if (rateLimit(`wd-code:${user.id}`, 3, 10 * 60_000).allowed === false) {
    return fail("Too many code requests. Try again in a few minutes.", 429, "RATE_LIMITED");
  }

  const code = String(randomInt(100000, 1000000));
  // invalidate older unused withdrawal codes for this phone
  await db.otpCode.updateMany({
    where: { phone: user.phone, purpose: { startsWith: "WITHDRAWAL:" }, used: false },
    data: { used: true },
  });
  await db.otpCode.create({
    data: {
      phone: user.phone,
      code: hashCode(code),
      purpose: `WITHDRAWAL:${amountCents}`,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });

  try {
    await sendSms(
      user.phone,
      `Gadaa Betting: your withdrawal code is ${code}. It expires in 5 minutes. Never share it with anyone.`
    );
  } catch {
    return fail("Could not send the SMS. Please try again.", 502, "SMS_FAILED");
  }

  await logAudit({
    actorId: user.id,
    action: "WITHDRAWAL_OTP_SENT",
    entity: "user",
    entityId: user.id,
    ip: clientIp(req),
    details: { amountCents },
  });

  return ok({
    sent: true,
    maskedPhone: maskPhone(user.phone),
    devOtp: process.env.NODE_ENV === "production" ? undefined : code,
  });
});