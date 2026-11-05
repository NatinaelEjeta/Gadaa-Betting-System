/**
 * In-memory rate limiter + brute-force lockout.
 * Sandbox note: swap with Redis (INCR + EXPIRE / token bucket Lua script) in
 * production — the interface below is intentionally Redis-shaped.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// periodic sweep so the map doesn't grow unbounded
let lastSweep = Date.now();
function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Fixed-window counter. Returns whether the call is allowed. */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  sweep();
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  return { allowed: true, remaining: limit - bucket.count, retryAfterSec: 0 };
}

// ---------------------------------------------------------------------------
// Login brute-force protection: 5 failures per phone+ip per 15 minutes
// ---------------------------------------------------------------------------

const FAIL_KEY_PREFIX = "login-fail:";
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

export function isLoginLocked(phone: string, ip: string): boolean {
  const bucket = buckets.get(FAIL_KEY_PREFIX + phone + ":" + ip);
  return !!bucket && bucket.count >= MAX_FAILS && bucket.resetAt > Date.now();
}

export function recordLoginFail(phone: string, ip: string) {
  const key = FAIL_KEY_PREFIX + phone + ":" + ip;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + FAIL_WINDOW_MS });
  } else {
    bucket.count += 1;
  }
}

export function clearLoginFails(phone: string, ip: string) {
  buckets.delete(FAIL_KEY_PREFIX + phone + ":" + ip);
}
