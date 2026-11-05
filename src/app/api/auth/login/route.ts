import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, clientIp, assertSameOrigin } from "@/lib/api";
import { loginSchema } from "@/lib/validation";
import { verifyPassword, normalizePhone, setSessionCookie } from "@/lib/auth";
import { rateLimit, isLoginLocked, recordLoginFail, clearLoginFails } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

/** POST /api/auth/login — phone + password with brute-force lockout. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  if (rateLimit(`login:${ip}`, 20, 60_000).allowed === false) {
    return fail("Too many attempts, slow down", 429, "RATE_LIMITED");
  }

  const data = loginSchema.parse(await readJson(req));
  const phone = normalizePhone(data.phone);

  if (isLoginLocked(phone, ip)) {
    return fail("Account temporarily locked after failed attempts. Try again in 15 minutes.", 429, "LOGIN_LOCKED");
  }

  const user = await db.user.findUnique({ where: { phone } });
  if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
    recordLoginFail(phone, ip);
    return fail("Invalid phone number or password", 401, "INVALID_CREDENTIALS");
  }
  if (user.status === "BANNED") {
    return fail("This account has been banned. Contact support.", 403, "BANNED");
  }
  if (user.status === "SUSPENDED") {
    return fail("This account is suspended. Contact support.", 403, "SUSPENDED");
  }

  clearLoginFails(phone, ip);
  const res = NextResponse.json({
    ok: true,
    data: {
      user: { id: user.id, phone: user.phone, fullName: user.fullName, role: user.role },
      phoneVerified: user.phoneVerified,
    },
  });
  await setSessionCookie(res, { uid: user.id, phone: user.phone, role: user.role });

  await db.session.upsert({
    where: { userId: user.id },
    update: { lastSeenAt: new Date(), loginCount: { increment: 1 }, ip },
    create: { userId: user.id, ip },
  });
  await logAudit({ actorId: user.id, action: "USER_LOGIN", entity: "user", entityId: user.id, ip });
  return res;
});
