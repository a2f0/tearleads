import { type BroadcastMessage, isRecord } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getRedisSubscriberClient } from '../../lib/redisPubSub.js';
import { addConnection, cleanupSseClient, removeConnection } from './shared.js';

async function isUserMemberOfGroup(
  userId: string,
  groupId: string
): Promise<boolean> {
  const pool = await getPostgresPool();
  const result = await pool.query(
    `SELECT 1
       FROM mls_group_members m
       INNER JOIN mls_groups g ON g.id = m.group_id
       INNER JOIN user_organizations uo
               ON uo.organization_id = g.organization_id
              AND uo.user_id = $2
      WHERE m.group_id = $1
        AND m.user_id = $2
        AND m.removed_at IS NULL
     LIMIT 1`,
    [groupId, userId]
  );
  return result.rows.length > 0;
}

async function filterAuthorizedChannels(
  channels: string[],
  userId: string
): Promise<string[]> {
  const authorized: string[] = [];

  for (const channel of channels) {
    if (channel === 'broadcast') {
      authorized.push(channel);
      continue;
    }

    if (channel.startsWith('mls:user:')) {
      const channelUserId = channel.slice('mls:user:'.length);
      if (channelUserId === userId) {
        authorized.push(channel);
      }
      continue;
    }

    if (channel.startsWith('mls:group:')) {
      const groupId = channel.slice('mls:group:'.length);
      const isMember = await isUserMemberOfGroup(userId, groupId);
      if (isMember) {
        authorized.push(channel);
      }
    }
  }

  return authorized;
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

/**
 * @openapi
 * /sse:
 *   get:
 *     summary: Server-Sent Events endpoint for real-time updates
 *     description: |
 *       Establishes an SSE connection for receiving real-time broadcasts via Redis pub/sub.
 *       Channel authorization is enforced - users can only subscribe to channels they have access to:
 *       - broadcast: always allowed
 *       - mls:user:{userId}: only allowed if userId matches the authenticated user
 *       - mls:group:{groupId}: only allowed if user is a member of the group
 *     tags:
 *       - SSE
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: channels
 *         schema:
 *           type: string
 *         description: Comma-separated list of channels to subscribe to (default "broadcast"). Unauthorized channels are silently filtered.
 *     responses:
 *       200:
 *         description: SSE stream established
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *       401:
 *         description: Unauthorized
 */
const getRootHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const channelsParam = req.query['channels'];
  const requestedChannels =
    typeof channelsParam === 'string'
      ? channelsParam
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : ['broadcast'];

  const channels = await filterAuthorizedChannels(
    requestedChannels,
    claims.sub
  );

  if (channels.length === 0) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: 'No authorized channels' })}\n\n`
    );
    res.end();
    return;
  }

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
};

export function registerGetRootRoute(routeRouter: RouterType): void {
  routeRouter.get('/', getRootHandler);
}
