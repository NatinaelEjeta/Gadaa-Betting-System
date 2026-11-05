import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionFromRequest, SessionPayload } from "@/lib/auth";

/**
 * Standard API envelope: { ok: true, data } | { ok: false, error, code? }.
 * All routes funnel through these helpers so the frontend gets a predictable shape.
 */

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

/** Wrap a route handler with uniform error handling. */
export function route<Args extends unknown[]>(
  fn: (req: NextRequest, ...args: Args) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: Args): Promise<NextResponse> => {
    try {
      return await fn(req, ...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.message, err.status, err.code);
      }
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
        return fail(`${path}${first?.message ?? "Invalid input"}`, 422, "VALIDATION_ERROR");
      }
      console.error("[api] unhandled error:", err);
      return fail("Internal server error", 500, "INTERNAL_ERROR");
    }
  };
}

/** CSRF protection for mutations: same-origin check when Origin header is present. */
export function assertSameOrigin(req: NextRequest) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, server-to-server) — protected by cookie SameSite
  const host = req.headers.get("host");
  try {
    if (new URL(origin).host !== host) {
      throw new ApiError("Cross-origin request blocked", 403, "CSRF");
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("Invalid origin", 403, "CSRF");
  }
}

/** Require an authenticated user; optionally enforce a role whitelist. */
export async function requireAuth(
  req: NextRequest,
  roles?: string[]
): Promise<SessionPayload> {
  const session = await getSessionFromRequest(req);
  if (!session) throw new ApiError("Authentication required", 401, "UNAUTHENTICATED");
  if (roles && roles.length > 0 && !roles.includes(session.role)) {
    throw new ApiError("Insufficient permissions", 403, "FORBIDDEN");
  }
  return session;
}

/** Parse a JSON body safely. */
export async function readJson<T = unknown>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError("Invalid JSON body", 400, "INVALID_JSON");
  }
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "127.0.0.1";
}
