/* istanbul ignore file */
import type {
  MlsMessage,
  MlsMessagesResponse,
  MlsMessageType
} from '@rapid/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

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
export const getGroupsGroupidMessagesHandler = async (
  req: Request,
  res: Response
) => {
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

  const cursor = req.query['cursor'] as string | undefined;
  const limit = Math.min(parseInt(req.query['limit'] as string, 10) || 50, 100);

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM mls_group_members
         WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
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

    if (cursor) {
      query += ` AND m.sequence_number < $2`;
      params.push(parseInt(cursor, 10));
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
