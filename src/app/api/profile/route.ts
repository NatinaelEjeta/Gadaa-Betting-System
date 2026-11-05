import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, route, readJson, requireAuth, assertSameOrigin } from "@/lib/api";
import { profileUpdateSchema } from "@/lib/validation";

/** PUT /api/profile — update display name / language preference. */
export const PUT = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req);
  const data = profileUpdateSchema.parse(await readJson(req));
  const user = await db.user.update({
    where: { id: session.uid },
    data: {
      ...(data.fullName ? { fullName: data.fullName } : {}),
      ...(data.language ? { language: data.language } : {}),
    },
  });
  return ok({ user: { id: user.id, fullName: user.fullName, language: user.language } });
});
