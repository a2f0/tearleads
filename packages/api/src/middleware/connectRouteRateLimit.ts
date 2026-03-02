import { rateLimit } from 'express-rate-limit';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 300;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getWindowMs(): number {
  return parsePositiveInt(
    process.env['CONNECT_ROUTE_RATE_LIMIT_WINDOW_MS'],
    DEFAULT_WINDOW_MS
  );
}

function getMaxRequests(): number {
  return parsePositiveInt(
    process.env['CONNECT_ROUTE_RATE_LIMIT_MAX_REQUESTS'],
    DEFAULT_MAX_REQUESTS
  );
}

function isTestRuntime(): boolean {
  return process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true';
}

export function createConnectRouteRateLimitMiddleware() {
  return rateLimit({
    windowMs: getWindowMs(),
    limit: getMaxRequests(),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTestRuntime(),
    handler: (_request, response) => {
      response.status(429).json({ error: 'Too many requests' });
    }
  });
}

export const connectRouteRateLimitMiddleware =
  createConnectRouteRateLimitMiddleware();
