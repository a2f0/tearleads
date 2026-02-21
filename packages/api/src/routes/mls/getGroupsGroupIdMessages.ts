import type {
  MlsMessage,
  MlsMessagesResponse,
  MlsMessageType
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getActiveMlsGroupMembership } from './shared.js';

/**
 * @openapi
 * /mls/groups/{groupId}/messages:
 *   get:
 *     summary: Get message history for MLS group
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
 *         name: cursor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Message history
 */
const getGroupsGroupidMessagesHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  const cursorParam = req.query['cursor'];
  let cursor: number | null = null;
  if (typeof cursorParam === 'string' && cursorParam.trim() !== '') {
    const parsedCursor = Number.parseInt(cursorParam, 10);
    if (!Number.isInteger(parsedCursor) || parsedCursor <= 0) {
      res.status(400).json({ error: 'cursor must be a positive integer' });
      return;
    }
    cursor = parsedCursor;
  }

  const limitParam = req.query['limit'];
  let limit = 50;
  if (typeof limitParam === 'string' && limitParam.trim() !== '') {
    const parsedLimit = Number.parseInt(limitParam, 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      res.status(400).json({ error: 'limit must be a positive integer' });
      return;
    }
    limit = Math.min(parsedLimit, 100);
  }

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Get messages with sender email
    let query = `SELECT m.id, m.group_id, m.sender_user_id, m.epoch, m.ciphertext,
                          m.message_type, m.content_type, m.sequence_number, m.created_at,
                          u.email as sender_email
                   FROM mls_messages m
                   LEFT JOIN users u ON u.id = m.sender_user_id
                   WHERE m.group_id = $1`;
    const params: unknown[] = [groupId];

    if (cursor !== null) {
      query += ` AND m.sequence_number < $2`;
      params.push(cursor);
    }

    query += ` ORDER BY m.sequence_number DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const result = await pool.query<{
      id: string;
      group_id: string;
      sender_user_id: string;
      epoch: number;
      ciphertext: string;
      message_type: string;
      content_type: string;
      sequence_number: number;
      created_at: Date;
      sender_email: string | null;
    }>(query, params);

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

    const messages: MlsMessage[] = rows.map((row) => {
      const createdAtStr = row.created_at.toISOString();
      const msg: MlsMessage = {
        id: row.id,
        groupId: row.group_id,
        senderUserId: row.sender_user_id,
        epoch: row.epoch,
        ciphertext: row.ciphertext,
        messageType: row.message_type as MlsMessageType,
        contentType: row.content_type,
        sequenceNumber: row.sequence_number,
        sentAt: createdAtStr,
        createdAt: createdAtStr
      };
      if (row.sender_email) {
        msg.senderEmail = row.sender_email;
      }
      return msg;
    });

    const response: MlsMessagesResponse = {
      messages: messages.reverse(), // Return in chronological order
      hasMore
    };
    if (hasMore && rows.length > 0) {
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        response.cursor = String(lastRow.sequence_number);
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Failed to get messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
};

export function registerGetGroupsGroupidMessagesRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/groups/:groupId/messages', getGroupsGroupidMessagesHandler);
}
