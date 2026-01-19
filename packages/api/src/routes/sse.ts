import { type BroadcastMessage, isRecord } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getRedisSubscriberClient } from '../lib/redisPubSub.js';

const router: RouterType = Router();

const activeConnections = new Set<Response>();

type SseCleanupClient = {
  unsubscribe: (channel: string) => Promise<void>;
  quit: () => Promise<string>;
};

export function addConnection(res: Response): void {
  activeConnections.add(res);
}

export function removeConnection(res: Response): void {
  activeConnections.delete(res);
}

export function closeAllSSEConnections(): void {
  for (const res of activeConnections) {
    try {
      res.write(
        `event: shutdown\ndata: ${JSON.stringify({ reason: 'server_restart' })}\n\n`
      );
      res.end();
    } catch {
      // Connection may already be closed
    }
  }
  activeConnections.clear();
}

function parseMessage(message: string): BroadcastMessage | null {
  try {
    const parsed = JSON.parse(message);
    return isBroadcastMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isBroadcastMessage(value: unknown): value is BroadcastMessage {
  return (
    isRecord(value) &&
    typeof value['type'] === 'string' &&
    'payload' in value &&
    typeof value['timestamp'] === 'string'
  );
}

export function cleanupSseClient(
  client: SseCleanupClient | null,
  channels: string[]
): Promise<string | undefined> {
  if (!client) {
    return Promise.resolve(undefined);
  }
  return Promise.all(channels.map((ch) => client.unsubscribe(ch))).then(() =>
    client.quit()
  );
}

/**
 * @openapi
 * /sse:
 *   get:
 *     summary: Server-Sent Events endpoint for real-time updates
 *     description: Establishes an SSE connection for receiving real-time broadcasts via Redis pub/sub
 *     tags:
 *       - SSE
 *     parameters:
 *       - in: query
 *         name: channels
 *         schema:
 *           type: string
 *         description: Comma-separated list of channels to subscribe to (default "broadcast")
 *     responses:
 *       200:
 *         description: SSE stream established
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 */
router.get('/', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const channelsParam = req.query['channels'];
  const channels =
    typeof channelsParam === 'string'
      ? channelsParam
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : ['broadcast'];

  res.write(`event: connected\ndata: ${JSON.stringify({ channels })}\n\n`);

  addConnection(res);

  let client: Awaited<ReturnType<typeof getRedisSubscriberClient>> | null =
    null;

  try {
    const subscriber = await getRedisSubscriberClient();
    client = subscriber.duplicate();
    await client.connect();

    const messageHandler = (message: string, channel: string) => {
      const parsedMessage = parseMessage(message);
      if (parsedMessage) {
        res.write(
          `event: message\ndata: ${JSON.stringify({ channel, message: parsedMessage })}\n\n`
        );
      }
    };

    for (const channel of channels) {
      await client.subscribe(channel, messageHandler);
    }

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      removeConnection(res);
      clearInterval(keepAlive);
      const clientToCleanup = client;
      client = null;
      cleanupSseClient(clientToCleanup, channels).catch((err) => {
        console.error('SSE cleanup error:', err);
      });
    });
  } catch (err) {
    removeConnection(res);
    console.error('SSE connection error:', err);
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: 'Failed to establish SSE connection' })}\n\n`
    );
    res.end();
  }
});

export { router as sseRouter };
