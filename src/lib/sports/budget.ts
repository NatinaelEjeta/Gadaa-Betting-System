/**
 * Provider request budgeting + retry with exponential backoff.
 *
 * The free API-Football plan allows 100 requests/day and 10/minute. The
 * budget tracker enforces both client-side, and additionally reads the
 * provider's rate-limit response headers to self-tune.
 */

export interface BudgetStats {
  dailyUsed: number;
  dailyLimit: number;
  minuteUsed: number;
  minuteLimit: number;
}

export class RequestBudget {
  private dailyLimit: number;
  private perMinuteLimit: number;
  private dailyUsed = 0;
  private dayKey = "";
  private minuteHits: number[] = [];

  constructor(dailyLimit: number, perMinuteLimit: number) {
    this.dailyLimit = dailyLimit;
    this.perMinuteLimit = perMinuteLimit;
  }

  private rollDay() {
    const key = new Date().toISOString().slice(0, 10);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dailyUsed = 0;
    }
  }

  canRequest(): boolean {
    this.rollDay();
    const now = Date.now();
    this.minuteHits = this.minuteHits.filter((t) => now - t < 60_000);
    return this.dailyUsed < this.dailyLimit && this.minuteHits.length < this.perMinuteLimit;
  }

  /** Seconds until the next request is allowed (0 if now). */
  retryAfterSeconds(): number {
    if (this.dailyUsed >= this.dailyLimit) return 3600;
    if (this.minuteHits.length >= this.perMinuteLimit) {
      const oldest = Math.min(...this.minuteHits);
      return Math.max(1, Math.ceil((60_000 - (Date.now() - oldest)) / 1000));
    }
    return 0;
  }

  record() {
    this.rollDay();
    this.dailyUsed += 1;
    this.minuteHits.push(Date.now());
  }

  /** Learn from provider headers (x-ratelimit-requests-*). */
  updateFromHeaders(limitLeft?: string | null, limitTotal?: string | null) {
    const left = Number.parseInt(limitLeft ?? "", 10);
    const total = Number.parseInt(limitTotal ?? "", 10);
    if (!Number.isNaN(total) && total > 0) {
      this.dailyLimit = Math.min(this.dailyLimit || total, total);
    }
    if (!Number.isNaN(left) && !Number.isNaN(total) && total >= left) {
      const used = total - left;
      // trust provider accounting if it is ahead of ours
      if (used > this.dailyUsed) this.dailyUsed = used;
    }
  }

  stats(): BudgetStats {
    const now = Date.now();
    this.minuteHits = this.minuteHits.filter((t) => now - t < 60_000);
    return {
      dailyUsed: this.dailyUsed,
      dailyLimit: this.dailyLimit,
      minuteUsed: this.minuteHits.length,
      minuteLimit: this.perMinuteLimit,
    };
  }
}

/** Exponential backoff w/ jitter for 429 / 5xx responses. */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  opts: { retries?: number; budget?: RequestBudget; headersCb?: (h: Headers) => void } = {}
): Promise<Response> {
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.budget && !opts.budget.canRequest()) {
      await sleep((opts.budget.retryAfterSeconds() || 1) * 1000);
    }
    opts.budget?.record();
    try {
      const res = await fetch(url, init);
      opts.headersCb?.(res.headers);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 300);
          continue;
        }
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 300);
        continue;
      }
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
