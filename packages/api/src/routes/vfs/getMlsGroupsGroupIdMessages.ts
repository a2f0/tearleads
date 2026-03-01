import type {
  MlsMessage,
  MlsMessagesResponse,
  MlsMessageType
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getActiveMlsGroupMembership } from '../mls/shared.js';

interface GroupMessageRow {
  id: string;
  group_id: string;
  sender_user_id: string | null;
  epoch: number;
  ciphertext: string;
  message_type: string;
  content_type: string;
  sequence_number: number;
  created_at: Date | string;
  sender_email: string | null;
}

/**
 * @openapi
 * /vfs/mls/groups/{groupId}/messages:
 *   get:
 *     summary: Get MLS application message history from VFS
 *     tags:
 *       - VFS
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
const getMlsGroupsGroupIdMessagesHandler = async (
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
    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const pool = await getPostgresPool();
    const result = await pool.query<GroupMessageRow>(
      `WITH group_messages AS (
         SELECT
           ops.item_id AS id,
           $1::text AS group_id,
           ops.actor_id AS sender_user_id,
           COALESCE(ops.key_epoch, 0) AS epoch,
           ops.encrypted_payload AS ciphertext,
           'application'::text AS message_type,
           COALESCE(msg.content_type, 'text/plain'::text) AS content_type,
           COALESCE(
             msg.sequence_number,
             ROW_NUMBER() OVER (
               ORDER BY ops.occurred_at ASC, ops.id ASC
             )::integer
           )::integer AS sequence_number,
           ops.occurred_at AS created_at,
           u.email AS sender_email
         FROM vfs_crdt_ops ops
         LEFT JOIN users u ON u.id = ops.actor_id
         LEFT JOIN mls_messages msg ON msg.id = ops.item_id
         WHERE ops.source_table = 'mls_messages'
           AND ops.op_type = 'item_upsert'
           AND ops.encrypted_payload IS NOT NULL
           AND ops.source_id LIKE $2::text
       )
       SELECT
         id,
         group_id,
         sender_user_id,
         epoch,
         ciphertext,
         message_type,
         content_type,
         sequence_number,
         created_at,
         sender_email
       FROM group_messages
       WHERE ($3::integer IS NULL OR sequence_number < $3::integer)
       ORDER BY sequence_number DESC
       LIMIT $4::integer`,
      [groupId, `mls_message:${groupId}:%`, cursor, limit + 1]
    );

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

    const messages: MlsMessage[] = rows.map((row) => {
      const createdAt =
        row.created_at instanceof Date
          ? row.created_at
          : new Date(row.created_at);
      const createdAtStr = createdAt.toISOString();
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
      messages: messages.reverse(),
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
    console.error('Failed to get VFS-backed MLS messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
};

export function registerGetMlsGroupsGroupIdMessagesRoute(
  routeRouter: RouterType
): void {
  routeRouter.get(
    '/mls/groups/:groupId/messages',
    getMlsGroupsGroupIdMessagesHandler
  );
}
