import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, fail, clientIp, assertSameOrigin } from "@/lib/api";
import { resetPasswordSchema } from "@/lib/validation";
import { normalizePhone, hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

/** POST /api/auth/reset-password — reset with OTP code. */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const data = resetPasswordSchema.parse(await readJson(req));
  const phone = normalizePhone(data.phone);

  const otp = await db.otpCode.findFirst({
    where: { phone, purpose: "PASSWORD_RESET", used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.code !== data.code) {
    return fail("Invalid or expired code", 400, "INVALID_OTP");
  }

  const user = await db.user.update({
    where: { phone },
    data: { passwordHash: await hashPassword(data.newPassword) },
  });
  await db.otpCode.update({ where: { id: otp.id }, data: { used: true } });

  await logAudit({ actorId: user.id, action: "PASSWORD_RESET", entity: "user", entityId: user.id, ip: clientIp(req) });
  return ok({ reset: true });
});
