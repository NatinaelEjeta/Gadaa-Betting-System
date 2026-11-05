import { NextRequest } from "next/server";
import { ok, route, readJson, requireAuth, clientIp, assertSameOrigin } from "@/lib/api";
import { getSettings, setSetting, DEFAULT_SETTINGS, PlatformSettings } from "@/lib/settings";
import { adminSettingsUpdateSchema } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

/** GET /api/admin/settings — platform configuration. */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const settings = await getSettings();
  return ok({ settings, defaults: DEFAULT_SETTINGS });
});

/** PUT /api/admin/settings — update limits, cadence, provider, bonuses. */
export const PUT = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  const session = await requireAuth(req, ["ADMIN", "SUPER_ADMIN"]);
  const data = adminSettingsUpdateSchema.parse(await readJson(req));

  const validKeys = Object.keys(DEFAULT_SETTINGS) as Array<keyof PlatformSettings>;
  const applied: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!validKeys.includes(key as keyof PlatformSettings)) continue;
    await setSetting(`platform.${key}`, value);
    applied[key] = value;
  }

  await logAudit({
    actorId: session.uid,
    actorPhone: session.phone,
    action: "SETTINGS_UPDATE",
    entity: "settings",
    ip: clientIp(req),
    details: applied,
  });

  const settings = await getSettings();
  return ok({ settings });
});
