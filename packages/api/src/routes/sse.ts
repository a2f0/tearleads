import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getRedisSubscriberClient } from '../lib/redisPubSub.js';

const router: RouterType = Router();

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

  let client: Awaited<ReturnType<typeof getRedisSubscriberClient>> | null =
    null;

  try {
    const subscriber = await getRedisSubscriberClient();
    client = subscriber.duplicate();
    await client.connect();

    const messageHandler = (message: string, channel: string) => {
      res.write(
        `event: message\ndata: ${JSON.stringify({ channel, message })}\n\n`
      );
    };

    for (const channel of channels) {
      await client.subscribe(channel, messageHandler);
    }

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', async () => {
      clearInterval(keepAlive);
      if (client) {
        for (const channel of channels) {
          await client.unsubscribe(channel);
        }
        await client.quit();
      }
    });
  } catch (err) {
    console.error('SSE connection error:', err);
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: 'Failed to establish SSE connection' })}\n\n`
    );
    res.end();
  }
});

export { router as sseRouter };
