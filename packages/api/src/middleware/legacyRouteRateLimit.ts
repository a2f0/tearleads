import type { NextFunction, Request, Response } from 'express';

type RateLimitBucket = {
  count: number;
  windowStartMs: number;
};

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 300;
const STALE_WINDOW_MULTIPLIER = 2;

const buckets = new Map<string, RateLimitBucket>();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getWindowMs(): number {
  return parsePositiveInt(
    process.env['LEGACY_ROUTE_RATE_LIMIT_WINDOW_MS'],
    DEFAULT_WINDOW_MS
  );
}

function getMaxRequests(): number {
  return parsePositiveInt(
    process.env['LEGACY_ROUTE_RATE_LIMIT_MAX_REQUESTS'],
    DEFAULT_MAX_REQUESTS
  );
}

function normalizeIp(request: Request): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
    const forwardedIp = forwardedFor.split(',')[0]?.trim();
    return forwardedIp && forwardedIp.length > 0
      ? forwardedIp
      : (request.ip ?? 'unknown');
  }

  return request.ip ?? 'unknown';
}

function bucketKey(request: Request): string {
  return `${normalizeIp(request)}:${request.path}`;
}

function cleanupStaleBuckets(nowMs: number, windowMs: number): void {
  for (const [key, bucket] of buckets.entries()) {
    if (nowMs - bucket.windowStartMs > windowMs * STALE_WINDOW_MULTIPLIER) {
      buckets.delete(key);
    }
  }
}

function isTestRuntime(): boolean {
  return process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true';
}

export function legacyRouteRateLimitMiddleware(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  if (isTestRuntime()) {
    next();
    return;
  }

  const nowMs = Date.now();
  const windowMs = getWindowMs();
  const maxRequests = getMaxRequests();
  const key = bucketKey(request);
  const bucket = buckets.get(key);

  if (!bucket || nowMs - bucket.windowStartMs >= windowMs) {
    buckets.set(key, { count: 1, windowStartMs: nowMs });
    cleanupStaleBuckets(nowMs, windowMs);
    next();
    return;
  }

  if (bucket.count >= maxRequests) {
    response.status(429).json({ error: 'Too many requests' });
    return;
  }

  bucket.count += 1;
  next();
}

export function resetLegacyRouteRateLimitBuckets(): void {
  buckets.clear();
}
