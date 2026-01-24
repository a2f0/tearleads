import { randomUUID } from 'node:crypto';
import {
  isRecord,
  type MlsMessage,
  type MlsMessagePost,
  type MlsMessagesResponse,
  type PostMlsMessageResponse
} from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { broadcast } from '../../lib/broadcast.js';
import { getPostgresPool } from '../../lib/postgres.js';

const router: RouterType = Router();

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;

function parseMessagePost(body: unknown): MlsMessagePost | null {
  if (!isRecord(body)) {
    return null;
  }
  const ciphertext = body['ciphertext'];
  const epoch = body['epoch'];
  if (
    typeof ciphertext !== 'string' ||
    !ciphertext.trim() ||
    typeof epoch !== 'number' ||
    !Number.isInteger(epoch) ||
    epoch < 0
  ) {
    return null;
  }
  return { ciphertext: ciphertext.trim(), epoch };
}

/**
 * @openapi
 * /mls/groups/{groupId}/messages:
 *   post:
 *     summary: Post encrypted message
 *     description: Posts an MLS-encrypted message to the group.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ciphertext:
 *                 type: string
 *                 description: Base64-encoded MLS ciphertext
 *               epoch:
 *                 type: integer
 *                 description: MLS epoch number
 *     responses:
 *       201:
 *         description: Message posted
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not a member
 */
router.post('/:groupId/messages', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupId = req.params['groupId'];
  if (!groupId) {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }

  const payload = parseMessagePost(req.body);
  if (!payload) {
    res.status(400).json({ error: 'ciphertext and epoch are required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, claims.sub]
    );
    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Get sender email
    const userResult = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [claims.sub]
    );
    const senderEmail = userResult.rows[0]?.email ?? 'unknown';

    const now = new Date();
    const messageId = randomUUID();

    // Use transaction for atomicity
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert message
      await client.query(
        `INSERT INTO chat_messages (id, group_id, sender_id, ciphertext, epoch, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [messageId, groupId, claims.sub, payload.ciphertext, payload.epoch, now]
      );

      // Update group updated_at
      await client.query(
        `UPDATE chat_groups SET updated_at = $1 WHERE id = $2`,
        [now, groupId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const message: MlsMessage = {
      id: messageId,
      groupId,
      senderId: claims.sub,
      senderEmail,
      ciphertext: payload.ciphertext,
      epoch: payload.epoch,
      createdAt: now.toISOString()
    };

    // Broadcast to group
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls_message',
      payload: message,
      timestamp: now.toISOString()
    });

    const response: PostMlsMessageResponse = { message };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to post message:', error);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

/**
 * @openapi
 * /mls/groups/{groupId}/messages:
 *   get:
 *     summary: Get message history
 *     description: Returns paginated message history for the group.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Cursor for pagination (message ID)
 *     responses:
 *       200:
 *         description: Message history
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not a member
 */
router.get('/:groupId/messages', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupId = req.params['groupId'];
  if (!groupId) {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }

  const limitParam = req.query['limit'];
  const cursor = req.query['cursor'];

  let limit = DEFAULT_MESSAGE_LIMIT;
  if (typeof limitParam === 'string') {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_MESSAGE_LIMIT);
    }
  }

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, claims.sub]
    );
    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Build query with optional cursor
    let query: string;
    let params: (string | number)[];

    if (typeof cursor === 'string' && cursor) {
      // Get the created_at of the cursor message
      const cursorResult = await pool.query<{ created_at: Date }>(
        `SELECT created_at FROM chat_messages WHERE id = $1`,
        [cursor]
      );
      const cursorDate = cursorResult.rows[0]?.created_at;

      if (cursorDate) {
        query = `
          SELECT m.id, m.group_id, m.sender_id, u.email as sender_email,
                 m.ciphertext, m.epoch, m.created_at
          FROM chat_messages m
          JOIN users u ON m.sender_id = u.id
          WHERE m.group_id = $1 AND m.created_at < $2
          ORDER BY m.created_at DESC
          LIMIT $3
        `;
        params = [groupId, cursorDate.toISOString(), limit + 1];
      } else {
        // Invalid cursor, start from beginning
        query = `
          SELECT m.id, m.group_id, m.sender_id, u.email as sender_email,
                 m.ciphertext, m.epoch, m.created_at
          FROM chat_messages m
          JOIN users u ON m.sender_id = u.id
          WHERE m.group_id = $1
          ORDER BY m.created_at DESC
          LIMIT $2
        `;
        params = [groupId, limit + 1];
      }
    } else {
      query = `
        SELECT m.id, m.group_id, m.sender_id, u.email as sender_email,
               m.ciphertext, m.epoch, m.created_at
        FROM chat_messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.group_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2
      `;
      params = [groupId, limit + 1];
    }

    const result = await pool.query<{
      id: string;
      group_id: string;
      sender_id: string;
      sender_email: string;
      ciphertext: string;
      epoch: number;
      created_at: Date;
    }>(query, params);

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

    const messages: MlsMessage[] = rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      senderId: row.sender_id,
      senderEmail: row.sender_email,
      ciphertext: row.ciphertext,
      epoch: row.epoch,
      createdAt: row.created_at.toISOString()
    }));

    // Reverse to chronological order
    messages.reverse();

    const lastRow = rows[rows.length - 1];
    const response: MlsMessagesResponse =
      hasMore && lastRow
        ? { messages, hasMore, nextCursor: lastRow.id }
        : { messages, hasMore };
    res.json(response);
  } catch (error) {
    console.error('Failed to get messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

export { router as messagesRouter };
