import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, clientIp, assertSameOrigin } from "@/lib/api";
import { otpSendSchema } from "@/lib/validation";
import { normalizePhone } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { randomInt } from "crypto";

/**
 * POST /api/auth/otp/send — issue an OTP (phone verification or password reset).
 * Sandbox: no SMS gateway wired; the code is returned as devOtp for testing.
 * Production: integrate an Ethiopian SMS provider (e.g. Africa's Talking).
 */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const data = otpSendSchema.parse(await readJson(req));
  const phone = normalizePhone(data.phone);

  if (rateLimit(`otp:${phone}`, 3, 10 * 60_000).allowed === false) {
    return fail("Too many OTP requests. Try again later.", 429, "RATE_LIMITED");
  }

  const user = await db.user.findUnique({ where: { phone } });
  if (!user) return fail("No account found for this phone number", 404, "NOT_FOUND");

  const code = String(randomInt(100000, 999999));
  await db.otpCode.create({
    data: {
      phone,
      code,
      purpose: data.purpose,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });

  return ok({
    sent: true,
    purpose: data.purpose,
    devOtp: process.env.NODE_ENV === "production" ? undefined : code,
  });
});
