import type { Redis } from "ioredis";

/**
 * Fixed-window rate limiter with Redis (shared across API replicas) and an
 * in-memory implementation for tests and single-node development.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowSec * 1000 };
      this.windows.set(key, w);
    }
    w.count++;
    if (this.windows.size > 50_000) this.gc(now);
    return {
      allowed: w.count <= limit,
      remaining: Math.max(0, limit - w.count),
      retryAfterSec: Math.ceil((w.resetAt - now) / 1000),
    };
  }

  private gc(now: number) {
    for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
  }
}

export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const k = `rl:${key}`;
    const res = await this.redis.multi().incr(k).expire(k, windowSec, "NX").ttl(k).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const ttl = Number(res?.[2]?.[1] ?? windowSec);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: ttl > 0 ? ttl : windowSec };
  }
}

/** Named policies so limits live in one place. */
export const RATE_LIMITS = {
  authLogin: { limit: 10, windowSec: 15 * 60 },
  authSignup: { limit: 5, windowSec: 60 * 60 },
  apiPerUser: { limit: 300, windowSec: 60 },
  apiPerIp: { limit: 600, windowSec: 60 },
  scanPerDay: { limit: 6, windowSec: 24 * 3600 },
  removalSubmitPerDay: { limit: 200, windowSec: 24 * 3600 },
  identifierChangesPerDay: { limit: 60, windowSec: 24 * 3600 },
  abuseReportPerIp: { limit: 5, windowSec: 3600 },
  exportPerDay: { limit: 5, windowSec: 24 * 3600 },
} as const;
