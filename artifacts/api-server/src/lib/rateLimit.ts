import type { Request, Response } from "express";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const SWEEP_INTERVAL_MS = 60_000;
let sweeper: NodeJS.Timeout | null = null;
function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }, SWEEP_INTERVAL_MS);
  sweeper.unref?.();
}

/**
 * Process-local rate limiter. Returns true and writes a 429 if the caller has
 * exceeded `limit` requests in the rolling `windowMs` window for `key`.
 *
 * Intentionally in-memory: the API server runs as a single process per
 * deployment, and AI endpoints are admin-only so request volume is small.
 * If we ever scale horizontally, swap this out for a Redis token bucket.
 */
export function rateLimited(
  res: Response,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  ensureSweeper();
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (existing.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Too many requests. Please slow down and try again shortly.",
      retryAfterSeconds: retryAfter,
    });
    return true;
  }
  existing.count += 1;
  return false;
}

export function rateLimitKey(req: Request, scope: string, actorId?: number | string | null): string {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    || req.ip
    || req.socket.remoteAddress
    || "unknown";
  return `${scope}:${actorId ?? "anon"}:${ip}`;
}
