import { randomUUID } from 'node:crypto';
import type { MlsMessage, SendMlsMessageResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import type { QueryResultRow } from 'pg';
import { broadcast } from '../../lib/broadcast.js';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  getActiveMlsGroupMembership,
  parseSendMessagePayload
} from '../mls/shared.js';

interface VfsMirrorInput {
  messageId: string;
  groupId: string;
  senderUserId: string;
  ciphertext: string;
  contentType: string;
  epoch: number;
  occurredAtIso: string;
  sequenceNumber: number;
}

interface QueryClient {
  query: <T extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
  release: () => void;
}

interface GroupMessageCountRow {
  message_count: string | number;
}

function toPositiveInteger(value: string | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return 0;
}

async function acquireTransactionClient(
  pool: Awaited<ReturnType<typeof getPostgresPool>>
): Promise<QueryClient> {
  if (typeof pool.connect !== 'function') {
    return {
      query: <T extends QueryResultRow = QueryResultRow>(
        queryText: string,
        values?: unknown[]
      ) => pool.query<T>(queryText, values),
      release: () => {}
    };
  }

  const client = await pool.connect();
  return {
    query: <T extends QueryResultRow = QueryResultRow>(
      queryText: string,
      values?: unknown[]
    ) => client.query<T>(queryText, values),
    release: () => client.release()
  };
}

async function persistApplicationMessageToVfs(
  client: QueryClient,
  input: VfsMirrorInput
): Promise<void> {
  await client.query(
    `
    INSERT INTO mls_messages (
      id,
      group_id,
      sender_user_id,
      epoch,
      ciphertext,
      message_type,
      content_type,
      sequence_number,
      created_at
    ) VALUES (
      $1::text,
      $2::text,
      $3::text,
      $4::integer,
      $5::text,
      'application',
      $6::text,
      $7::integer,
      $8::timestamptz
    )
    ON CONFLICT (id) DO UPDATE
    SET
      epoch = EXCLUDED.epoch,
      ciphertext = EXCLUDED.ciphertext,
      content_type = EXCLUDED.content_type,
      sequence_number = EXCLUDED.sequence_number,
      created_at = EXCLUDED.created_at
    `,
    [
      input.messageId,
      input.groupId,
      input.senderUserId,
      input.epoch,
      input.ciphertext,
      input.contentType,
      input.sequenceNumber,
      input.occurredAtIso
    ]
  );

  await client.query(
    `
    INSERT INTO vfs_registry (
      id,
      object_type,
      owner_id,
      created_at
    ) VALUES (
      $1::text,
      'mlsMessage',
      NULL,
      $2::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
    `,
    [input.messageId, input.occurredAtIso]
  );

  await client.query(
    `
    INSERT INTO vfs_item_state (
      item_id,
      encrypted_payload,
      key_epoch,
      updated_at,
      deleted_at
    ) VALUES (
      $1::text,
      $2::text,
      $3::integer,
      $4::timestamptz,
      NULL
    )
    ON CONFLICT (item_id) DO UPDATE
    SET
      encrypted_payload = EXCLUDED.encrypted_payload,
      key_epoch = EXCLUDED.key_epoch,
      updated_at = EXCLUDED.updated_at,
      deleted_at = NULL
    `,
    [input.messageId, input.ciphertext, input.epoch, input.occurredAtIso]
  );

  await client.query(
    `
    INSERT INTO vfs_acl_entries (
      id,
      item_id,
      principal_type,
      principal_id,
      access_level,
      granted_by,
      created_at,
      updated_at,
      revoked_at,
      expires_at
    )
    SELECT
      vfs_make_event_id('acl'),
      $1::text,
      'user',
      member.user_id,
      'read',
      $2::text,
      $3::timestamptz,
      $3::timestamptz,
      NULL,
      NULL
    FROM mls_group_members member
    WHERE member.group_id = $4::text
      AND member.removed_at IS NULL
    ON CONFLICT (item_id, principal_type, principal_id) DO UPDATE
    SET
      access_level = EXCLUDED.access_level,
      granted_by = EXCLUDED.granted_by,
      updated_at = EXCLUDED.updated_at,
      revoked_at = NULL,
      expires_at = NULL
    `,
    [input.messageId, input.senderUserId, input.occurredAtIso, input.groupId]
  );

  await client.query(
    `
    INSERT INTO vfs_crdt_ops (
      id,
      item_id,
      op_type,
      actor_id,
      source_table,
      source_id,
      occurred_at,
      encrypted_payload,
      key_epoch
    ) VALUES (
      vfs_make_event_id('crdt'),
      $1::text,
      'item_upsert',
      $2::text,
      'mls_messages',
      $3::text,
      $4::timestamptz,
      $5::text,
      $6::integer
    )
    `,
    [
      input.messageId,
      input.senderUserId,
      `mls_message:${input.groupId}:${input.sequenceNumber}:${input.messageId}`,
      input.occurredAtIso,
      input.ciphertext,
      input.epoch
    ]
  );
}

/**
 * @openapi
 * /vfs/mls/groups/{groupId}/messages:
 *   post:
 *     summary: Store an MLS application message in VFS
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
 *     responses:
 *       201:
 *         description: Message stored
 */
const postMlsGroupsGroupIdMessagesHandler = async (
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

  const payload = parseSendMessagePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid message payload' });
    return;
  }

  if (payload.messageType !== 'application') {
    res.status(400).json({ error: 'Only application messages are supported' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const client = await acquireTransactionClient(pool);
    let message: MlsMessage | null = null;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
        groupId
      ]);

      const groupEpochResult = await client.query<{ current_epoch: number }>(
        `SELECT current_epoch
           FROM mls_groups
          WHERE id = $1
          LIMIT 1
          FOR UPDATE`,
        [groupId]
      );
      const currentEpoch = groupEpochResult.rows[0]?.current_epoch;
      if (typeof currentEpoch !== 'number') {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Group not found' });
        return;
      }
      if (payload.epoch !== currentEpoch) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Epoch mismatch' });
        return;
      }

      const messageCountResult = await client.query<GroupMessageCountRow>(
        `SELECT COALESCE(COUNT(*), 0) AS message_count
           FROM vfs_crdt_ops
          WHERE source_table = 'mls_messages'
            AND op_type = 'item_upsert'
            AND source_id LIKE $1`,
        [`mls_message:${groupId}:%`]
      );
      const nextSequenceNumber =
        toPositiveInteger(messageCountResult.rows[0]?.message_count ?? 0) + 1;

      const id = randomUUID();
      const occurredAtIso = new Date().toISOString();
      const contentType = payload.contentType ?? 'text/plain';

      await persistApplicationMessageToVfs(client, {
        messageId: id,
        groupId,
        senderUserId: claims.sub,
        ciphertext: payload.ciphertext,
        contentType,
        epoch: payload.epoch,
        occurredAtIso,
        sequenceNumber: nextSequenceNumber
      });

      message = {
        id,
        groupId,
        senderUserId: claims.sub,
        epoch: payload.epoch,
        ciphertext: payload.ciphertext,
        messageType: payload.messageType,
        contentType,
        sequenceNumber: nextSequenceNumber,
        sentAt: occurredAtIso,
        createdAt: occurredAtIso
      };

      await client.query('COMMIT');
    } catch (transactionError) {
      await client.query('ROLLBACK').catch(() => {});
      throw transactionError;
    } finally {
      client.release();
    }

    if (!message) {
      return;
    }

    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:message',
      payload: message,
      timestamp: message.createdAt
    });

    const response: SendMlsMessageResponse = { message };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to store VFS-backed MLS message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

export function registerPostMlsGroupsGroupIdMessagesRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/mls/groups/:groupId/messages',
    postMlsGroupsGroupIdMessagesHandler
  );
}
