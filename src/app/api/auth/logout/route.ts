import { NextRequest, NextResponse } from "next/server";
import { route, assertSameOrigin } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth";

/** POST /api/auth/logout */
export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  return clearSessionCookie(NextResponse.json({ ok: true, data: { loggedOut: true } }));
});
