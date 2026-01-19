import type { Server } from 'node:http';
import dbPackageJson from '@rapid/db/package.json' with { type: 'json' };
import type { PingData } from '@rapid/shared';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { type Express, type Request, type Response } from 'express';
import packageJson from '../package.json' with { type: 'json' };
import { closeRedisClient } from './lib/redis.js';
import { closeRedisSubscriberClient } from './lib/redisPubSub.js';
import { closePostgresPool } from './lib/postgres.js';
import { redisRouter } from './routes/admin/redis.js';
import { postgresRouter } from './routes/admin/postgres.js';
import { chatRouter } from './routes/chat.js';
import { emailsRouter } from './routes/emails.js';
import { closeAllSSEConnections, sseRouter } from './routes/sse.js';

dotenv.config();

const app: Express = express();

const PORT = Number(process.env['PORT']) || 5001;

// Middleware
app.use(cors());
app.use(express.json());

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
  const pingData: PingData = {
    version: packageJson.version,
    dbVersion: dbPackageJson.version
  };
  res.status(200).json(pingData);
});

// Admin routes
app.use('/v1/admin/redis', redisRouter);
app.use('/v1/admin/postgres', postgresRouter);

// Chat completion route
app.use('/v1/chat', chatRouter);

// Email routes
app.use('/v1/emails', emailsRouter);

// SSE route
app.use('/v1/sse', sseRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Export app for testing
export { app };

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
