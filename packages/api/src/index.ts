import type { Server } from 'node:http';
import dbPackageJson from '@tearleads/db/package.json' with { type: 'json' };
import type { PingData } from '@tearleads/shared';
import { closeRedisClient } from '@tearleads/shared/redis';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { type Express, type Request, type Response } from 'express';
import morgan from 'morgan';
import packageJson from '../package.json' with { type: 'json' };
import { closePostgresPool } from './lib/postgres.js';
import { closeRedisSubscriberClient } from './lib/redisPubSub.js';
import { adminAccessMiddleware } from './middleware/adminAccess.js';
import { adminSessionMiddleware } from './middleware/adminSession.js';
import { authMiddleware } from './middleware/auth.js';
import { adminContextRouter } from './routes/admin/context.js';
import { groupsRouter } from './routes/admin/groups.js';
import { organizationsRouter } from './routes/admin/organizations.js';
import { postgresRouter } from './routes/admin/postgres.js';
import { redisRouter } from './routes/admin/redis.js';
import { usersRouter } from './routes/admin/users.js';
import { aiConversationsRouter } from './routes/ai-conversations/router.js';
import { authRouter } from './routes/auth/router.js';
import { billingRouter } from './routes/billing/router.js';
import { chatRouter } from './routes/chat/router.js';
import { mlsRouter } from './routes/mls/router.js';
import { revenuecatRouter } from './routes/revenuecat/router.js';
import { closeAllSSEConnections, sseRouter } from './routes/sse/router.js';
import { vfsRouter } from './routes/vfs/router.js';
import { vfsSharesRouter } from './routes/vfs-shares/router.js';

dotenv.config({ quiet: true });

const app: Express = express();

const PORT = Number(process.env['PORT']) || 5001;

// Middleware
app.use(cors());
app.use(
  morgan(process.env['NODE_ENV'] === 'production' ? 'short' : 'dev', {
    skip: () => process.env['NODE_ENV'] === 'test'
  })
);

const jsonBodyLimit = process.env['API_JSON_BODY_LIMIT'] ?? '10mb';

// RevenueCat webhook route needs raw body for signature verification.
app.use(
  '/v1/revenuecat',
  express.raw({
    type: 'application/json',
    limit: jsonBodyLimit
  }),
  revenuecatRouter
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
 *     PingData:
 *       type: object
 *       properties:
 *         version:
 *           type: string
 *           description: Current API version
 *           example: "0.0.74"
 *         dbVersion:
 *           type: string
 *           description: Current database schema version
 *           example: "0.0.1"
 *         emailDomain:
 *           type: string
 *           description: Domain for user email addresses (first from SMTP_RECIPIENT_DOMAINS)
 *           example: "email.example.com"
 *       required:
 *         - version
 *         - dbVersion
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 *       required:
 *         - error
 */

/**
 * @openapi
 * /ping:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the current API version
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PingData'
 */
app.get('/v1/ping', (_req: Request, res: Response) => {
  const emailDomains = (process.env['SMTP_RECIPIENT_DOMAINS'] ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
  const pingData: PingData = {
    version: packageJson.version,
    dbVersion: dbPackageJson.version,
    ...(emailDomains[0] ? { emailDomain: emailDomains[0] } : {})
  };
  res.status(200).json(pingData);
});

app.use('/v1', authMiddleware);

// Admin routes
app.use('/v1/admin/redis', adminSessionMiddleware, redisRouter);
app.use('/v1/admin/postgres', adminSessionMiddleware, postgresRouter);
app.use('/v1/admin/context', adminAccessMiddleware, adminContextRouter);
app.use('/v1/admin/groups', adminAccessMiddleware, groupsRouter);
app.use('/v1/admin/organizations', adminAccessMiddleware, organizationsRouter);
app.use('/v1/admin/users', adminAccessMiddleware, usersRouter);

// Auth routes
app.use('/v1/auth', authRouter);

// Billing routes
app.use('/v1/billing', billingRouter);

// Chat completion route
app.use('/v1/chat', chatRouter);

// AI conversations and usage tracking
app.use('/v1/ai', aiConversationsRouter);

// SSE route
app.use('/v1/sse', sseRouter);

// VFS routes
app.use('/v1/vfs', vfsRouter);
app.use('/v1/vfs', vfsSharesRouter);

// MLS routes
app.use('/v1/mls', mlsRouter);

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

  closeAllSSEConnections();

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
