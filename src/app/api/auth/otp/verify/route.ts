import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, assertSameOrigin } from "@/lib/api";
import { otpVerifySchema } from "@/lib/validation";
import { normalizePhone } from "@/lib/auth";

/** POST /api/auth/otp/verify — confirm a PHONE_VERIFY OTP. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const data = otpVerifySchema.parse(await readJson(req));
  const phone = normalizePhone(data.phone);

  const otp = await db.otpCode.findFirst({
    where: { phone, purpose: "PHONE_VERIFY", used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.code !== data.code) {
    return fail("Invalid or expired code", 400, "INVALID_OTP");
  }

  await db.$transaction([
    db.otpCode.update({ where: { id: otp.id }, data: { used: true } }),
    db.user.update({ where: { phone }, data: { phoneVerified: true } }),
  ]);

  return ok({ verified: true });
});
