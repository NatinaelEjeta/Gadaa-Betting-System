import { NextRequest } from "next/server";
import { ok, route, readJson, fail, assertSameOrigin } from "@/lib/api";
import { forgotPasswordSchema } from "@/lib/validation";
import { normalizePhone } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { randomInt } from "crypto";

/**
 * POST /api/auth/forgot-password — issue a password-reset OTP.
 * Sandbox: the code is returned as devOtp (no SMS provider in this environment).
 */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const data = forgotPasswordSchema.parse(await readJson(req));
  const phone = normalizePhone(data.phone);

  if (rateLimit(`forgot:${phone}`, 3, 10 * 60_000).allowed === false) {
    return fail("Too many requests. Try again later.", 429, "RATE_LIMITED");
  }

  const user = await db.user.findUnique({ where: { phone } });
  if (!user) return fail("No account found for this phone number", 404, "NOT_FOUND");

  const code = String(randomInt(100000, 999999));
  await db.otpCode.create({
    data: { phone, code, purpose: "PASSWORD_RESET", expiresAt: new Date(Date.now() + 10 * 60_000) },
  });

  return ok({
    sent: true,
    devOtp: process.env.NODE_ENV === "production" ? undefined : code,
  });
});
