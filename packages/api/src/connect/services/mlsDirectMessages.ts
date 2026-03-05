import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  MlsMessage,
  MlsMessagesResponse,
  SendMlsMessageRequest,
  SendMlsMessageResponse
} from '@tearleads/shared';
import { broadcast } from '../../lib/broadcast.js';
import { getPostgresPool } from '../../lib/postgres.js';
import { requireMlsClaims } from './mlsDirectAuth.js';
import { encoded, parseJsonBody } from './mlsDirectCommon.js';
import {
  acquireTransactionClient,
  decodeContentTypeFromSourceId,
  type GroupMaxSequenceRow,
  type GroupMessageRow,
  persistApplicationMessageToVfs,
  toIsoString,
  toPositiveInteger
} from './mlsDirectMessagesShared.js';
import {
  getActiveMlsGroupMembership,
  parseSendMessagePayload
} from './mlsDirectShared.js';
import { shouldReadEnvelopeBytea } from './vfsDirectCrdtEnvelopeReadOptions.js';

type GroupIdJsonRequest = { groupId: string; json: string };
type GroupIdTypedRequest = { groupId: string } & SendMlsMessageRequest;
type GroupMessagesRequest = { groupId: string; cursor: string; limit: number };

export async function sendGroupMessageDirectTyped(
  request: GroupIdTypedRequest,
  context: { requestHeader: Headers }
): Promise<SendMlsMessageResponse> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}/messages`,
    context.requestHeader
  );

  const trimmedContentType = request.contentType?.trim();
  const payload: SendMlsMessageRequest = {
    ciphertext: request.ciphertext.trim(),
    epoch: request.epoch,
    messageType: request.messageType,
    ...(trimmedContentType ? { contentType: trimmedContentType } : {})
  };
  if (
    payload.ciphertext.length === 0 ||
    !Number.isInteger(payload.epoch) ||
    payload.epoch < 0
  ) {
    throw new ConnectError('Invalid message payload', Code.InvalidArgument);
  }

  if (payload.messageType !== 'application') {
    throw new ConnectError(
      'Only application messages are supported',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      throw new ConnectError(
        'Not a member of this group',
        Code.PermissionDenied
      );
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
        throw new ConnectError('Group not found', Code.NotFound);
      }

      if (payload.epoch !== currentEpoch) {
        throw new ConnectError('Epoch mismatch', Code.AlreadyExists);
      }

      const maxSequenceResult = await client.query<GroupMaxSequenceRow>(
        `SELECT
           CASE
             WHEN split_part(source_id, ':', 3) ~ '^[0-9]+$'
             THEN split_part(source_id, ':', 3)::integer
             ELSE NULL
           END AS sequence_number
           FROM vfs_crdt_ops
          WHERE op_type = 'item_upsert'
            AND source_table IN ('mls_messages', 'mls_message')
            AND split_part(source_id, ':', 1) = 'mls_message'
            AND split_part(source_id, ':', 2) = $1::text
          ORDER BY
            CASE
              WHEN split_part(source_id, ':', 3) ~ '^[0-9]+$'
              THEN split_part(source_id, ':', 3)::integer
              ELSE NULL
            END DESC NULLS LAST
          LIMIT 1`,
        [groupId]
      );

      const nextSequenceNumber =
        toPositiveInteger(maxSequenceResult.rows[0]?.sequence_number ?? 0) + 1;

      const id = randomUUID();
      const occurredAtIso = new Date().toISOString();
      const contentType = payload.contentType ?? 'text/plain';

      await persistApplicationMessageToVfs(client, {
        messageId: id,
        groupId,
        organizationId: membership.organizationId,
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
      throw new ConnectError('Failed to send message', Code.Internal);
    }

    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:message',
      payload: message,
      timestamp: message.createdAt
    });

    return { message };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to store VFS-backed MLS message:', error);
    throw new ConnectError('Failed to send message', Code.Internal);
  }
}

export async function sendGroupMessageDirect(
  request: GroupIdJsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const payload = parseSendMessagePayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError('Invalid message payload', Code.InvalidArgument);
  }

  const response = await sendGroupMessageDirectTyped(
    { groupId: request.groupId, ...payload },
    context
  );
  return { json: JSON.stringify(response) };
}

export async function getGroupMessagesDirectTyped(
  request: GroupMessagesRequest,
  context: { requestHeader: Headers }
): Promise<MlsMessagesResponse> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}/messages`,
    context.requestHeader
  );

  const trimmedCursor = request.cursor.trim();
  let cursor: number | null = null;
  if (trimmedCursor.length > 0) {
    const parsedCursor = Number.parseInt(trimmedCursor, 10);
    if (!Number.isInteger(parsedCursor) || parsedCursor <= 0) {
      throw new ConnectError(
        'cursor must be a positive integer',
        Code.InvalidArgument
      );
    }

    cursor = parsedCursor;
  }

  const normalizedLimit =
    Number.isFinite(request.limit) && request.limit > 0
      ? Math.floor(request.limit)
      : 50;
  const limit = Math.min(normalizedLimit, 100);

  try {
    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      throw new ConnectError(
        'Not a member of this group',
        Code.PermissionDenied
      );
    }

    const pool = await getPostgresPool();
    const includeEnvelopeByteaReads = shouldReadEnvelopeBytea();

    const result = await pool.query<GroupMessageRow>(
      `WITH group_messages AS (
         SELECT
           ops.item_id AS id,
           $1::text AS group_id,
           ops.actor_id AS sender_user_id,
           COALESCE(ops.key_epoch, 0) AS epoch,
           CASE
             WHEN $5::boolean AND ops.encrypted_payload_bytes IS NOT NULL
               THEN encode(ops.encrypted_payload_bytes, 'base64')
             ELSE ops.encrypted_payload
           END AS ciphertext,
           NULLIF(split_part(ops.source_id, ':', 5), '') AS encoded_content_type,
           legacy.content_type AS legacy_content_type,
           CASE
             WHEN split_part(ops.source_id, ':', 3) ~ '^[0-9]+$'
             THEN split_part(ops.source_id, ':', 3)::integer
             ELSE legacy.sequence_number
           END::integer AS sequence_number,
           ops.occurred_at AS created_at,
           u.email AS sender_email
         FROM vfs_crdt_ops ops
         LEFT JOIN users u ON u.id = ops.actor_id
         LEFT JOIN mls_messages legacy ON legacy.id = ops.item_id
         WHERE ops.source_table IN ('mls_messages', 'mls_message')
           AND ops.op_type = 'item_upsert'
           AND (
             ops.encrypted_payload_bytes IS NOT NULL
             OR ops.encrypted_payload IS NOT NULL
           )
           AND ops.source_id LIKE $2::text
       )
       SELECT
         id,
         group_id,
         sender_user_id,
         epoch,
         ciphertext,
         encoded_content_type,
         legacy_content_type,
         sequence_number,
         created_at,
         sender_email
       FROM group_messages
       WHERE sequence_number IS NOT NULL
         AND ($3::integer IS NULL OR sequence_number < $3::integer)
       ORDER BY sequence_number DESC
       LIMIT $4::integer`,
      [
        groupId,
        `mls_message:${groupId}:%`,
        cursor,
        limit + 1,
        includeEnvelopeByteaReads
      ]
    );

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

    const messages: MlsMessage[] = rows.map((row) => {
      const createdAt = toIsoString(row.created_at);
      const message: MlsMessage = {
        id: row.id,
        groupId: row.group_id,
        senderUserId: row.sender_user_id ?? '',
        epoch: row.epoch,
        ciphertext: row.ciphertext,
        messageType: 'application',
        contentType: decodeContentTypeFromSourceId(
          row.encoded_content_type,
          row.legacy_content_type
        ),
        sequenceNumber: row.sequence_number,
        sentAt: createdAt,
        createdAt
      };

      if (row.sender_email) {
        message.senderEmail = row.sender_email;
      }

      return message;
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

    return response;
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get VFS-backed MLS messages:', error);
    throw new ConnectError('Failed to get messages', Code.Internal);
  }
}

export async function getGroupMessagesDirect(
  request: GroupMessagesRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const response = await getGroupMessagesDirectTyped(request, context);
  return { json: JSON.stringify(response) };
}
