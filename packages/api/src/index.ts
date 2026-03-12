import type { Server } from 'node:http';
import { expressConnectMiddleware } from '@connectrpc/connect-express';
import { closeRedisClient } from '@tearleads/shared/redis';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { type Express, type Request, type Response } from 'express';
import morgan from 'morgan';
import { authInterceptor } from './connect/interceptors/authInterceptor.js';
import { registerConnectRoutes } from './connect/router.js';
import { postRevenuecatWebhooks } from './http/revenuecatWebhookRoute.js';
import { closePostgresPool } from './lib/postgres.js';
import { closeRedisSubscriberClient } from './lib/redisPubSub.js';
import { connectRouteRateLimitMiddleware } from './middleware/connectRouteRateLimit.js';

dotenv.config({ quiet: true });

const app: Express = express();

const PORT = Number(process.env['PORT']) || 5001;
const CORS_ALLOWED_ORIGINS_ENV = 'API_CORS_ALLOWED_ORIGINS';
type CorsOriginPolicy = (
  requestOrigin: string | undefined,
  callback: (err: Error | null, origin?: boolean) => void
) => void;

export function parseCorsAllowedOrigins(
  value: string | undefined
): ReadonlySet<string> {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  );
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsedOrigin = new URL(origin);
    const isAllowedProtocol =
      parsedOrigin.protocol === 'http:' ||
      parsedOrigin.protocol === 'https:' ||
      parsedOrigin.protocol === 'capacitor:';

    return (
      isAllowedProtocol &&
      (parsedOrigin.hostname === 'localhost' ||
        parsedOrigin.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

export function isCorsOriginAllowed(
  origin: string,
  allowedOrigins: ReadonlySet<string>,
  allowLoopbackOrigins: boolean
): boolean {
  if (allowedOrigins.has(origin)) {
    return true;
  }

  return allowLoopbackOrigins && isLoopbackOrigin(origin);
}

export function createCorsOriginPolicy({
  allowedOrigins,
  allowLoopbackOrigins
}: {
  allowedOrigins: ReadonlySet<string>;
  allowLoopbackOrigins: boolean;
}): CorsOriginPolicy {
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    callback(
      null,
      isCorsOriginAllowed(origin, allowedOrigins, allowLoopbackOrigins)
    );
  };
}

const allowedCorsOrigins = parseCorsAllowedOrigins(
  process.env[CORS_ALLOWED_ORIGINS_ENV]
);
const allowLoopbackCorsOrigins = process.env['NODE_ENV'] !== 'production';

// Middleware
app.use(
  cors({
    origin: createCorsOriginPolicy({
      allowedOrigins: allowedCorsOrigins,
      allowLoopbackOrigins: allowLoopbackCorsOrigins
    }),
    credentials: true
  })
);
app.use(
  morgan(process.env['NODE_ENV'] === 'production' ? 'short' : 'dev', {
    skip: () => process.env['NODE_ENV'] === 'test'
  })
);

const jsonBodyLimit = process.env['API_JSON_BODY_LIMIT'] ?? '10mb';

// RevenueCat webhook route needs raw body for signature verification.
app.post(
  '/v1/revenuecat/webhooks',
  express.raw({
    type: 'application/json',
    limit: jsonBodyLimit
  }),
  postRevenuecatWebhooks
);

app.use('/v1/connect', connectRouteRateLimitMiddleware);

app.use(
  expressConnectMiddleware({
    requestPathPrefix: '/v1/connect',
    routes: registerConnectRoutes,
    interceptors: [authInterceptor]
  })
);

app.use(
  express.json({
    limit: jsonBodyLimit
  })
);

/**
 * @openapi
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 *       required:
 *         - error
 */
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Export app for testing
export { app };

// Export migrations for test utilities
export { migrations, runMigrations } from './migrations/index.js';

// Graceful shutdown handler
let isShuttingDown = false;

export function resetShutdownState(): void {
  isShuttingDown = false;
}

export async function gracefulShutdown(
  server: Server,
  signal: string
): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(`\n${signal} received, starting graceful shutdown...`);

  const timeoutId = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);

  server.close(async () => {
    console.log('HTTP server closed');
    await Promise.all([
      closeRedisClient(),
      closeRedisSubscriberClient(),
      closePostgresPool()
    ]);
    console.log('Redis/Postgres connections closed');
    clearTimeout(timeoutId);
    process.exit(0);
  });
}

// Start server only when run directly
/* istanbul ignore next -- @preserve server startup for production */
if (process.env['NODE_ENV'] !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });

  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
}
