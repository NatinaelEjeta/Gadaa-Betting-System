import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, clientIp, assertSameOrigin } from "@/lib/api";
import { registerSchema } from "@/lib/validation";
import { hashPassword, normalizePhone, isValidEthiopianPhone } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { randomInt } from "crypto";

/**
 * POST /api/auth/register
 * Phone + password registration with 18+ age gate, referral capture and an
 * OTP verification code (sandbox: code returned in response — plug an SMS
 * gateway in production).
 */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  const limit = rateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) return fail("Too many registrations from this address", 429, "RATE_LIMITED");

  const body = await readJson(req);
  const data = registerSchema.parse(body);
  const phone = normalizePhone(data.phone);
  if (!isValidEthiopianPhone(phone)) {
    return fail("Enter a valid Ethiopian phone number (+2519XXXXXXXX)", 422, "INVALID_PHONE");
  }

  const existing = await db.user.findUnique({ where: { phone } });
  if (existing) return fail("An account with this phone number already exists", 409, "PHONE_TAKEN");

  // referral
  let referredById: string | undefined;
  if (data.referralCode) {
    const referrer = await db.user.findUnique({ where: { referralCode: data.referralCode.trim().toUpperCase() } });
    if (!referrer) return fail("Invalid referral code", 422, "INVALID_REFERRAL");
    referredById = referrer.id;
  }

  const user = await db.user.create({
    data: {
      phone,
      fullName: data.fullName,
      passwordHash: await hashPassword(data.password),
      dateOfBirth: data.dateOfBirth,
      language: data.language ?? "en",
      referralCode: `G${phone.slice(-6)}${randomInt(100, 999)}`,
      referredById,
    },
  });
  await db.wallet.create({ data: { userId: user.id } });
  if (referredById) {
    await db.referral.create({ data: { referrerId: referredById, refereeId: user.id } });
  }

  // OTP for phone verification
  const code = String(randomInt(100000, 999999));
  await db.otpCode.create({
    data: { phone, code, purpose: "PHONE_VERIFY", expiresAt: new Date(Date.now() + 10 * 60_000) },
  });

  await logAudit({ action: "USER_REGISTER", entity: "user", entityId: user.id, ip, details: { phone, referred: !!referredById } });

  return NextResponse.json({
    ok: true,
    data: {
      userId: user.id,
      phone,
      phoneVerified: false,
      // Sandbox: no SMS provider wired — surface the code for the demo flow.
      devOtp: process.env.NODE_ENV === "production" ? undefined : code,
      message: "Account created. Verify your phone with the OTP code.",
    },
  });
});
