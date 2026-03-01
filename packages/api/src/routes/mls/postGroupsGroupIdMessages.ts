import { randomUUID } from 'node:crypto';
import type { MlsMessage, SendMlsMessageResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { broadcast } from '../../lib/broadcast.js';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  getActiveMlsGroupMembership,
  parseSendMessagePayload
} from './shared.js';

interface VfsMirrorInput {
  messageId: string;
  groupId: string;
  senderUserId: string;
  organizationId: string;
  ciphertext: string;
  epoch: number;
  occurredAtIso: string;
}

async function mirrorApplicationMessageToVfs(input: VfsMirrorInput) {
  const pool = await getPostgresPool();

  await pool.query(
    `
    INSERT INTO vfs_registry (
      id,
      object_type,
      owner_id,
      organization_id,
      created_at
    ) VALUES (
      $1::text,
      'mlsMessage',
      NULL,
      $2::text,
      $3::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
    `,
    [input.messageId, input.organizationId, input.occurredAtIso]
  );

  await pool.query(
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

  await pool.query(
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

  await pool.query(
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
      `mls_message:${input.groupId}:${input.messageId}`,
      input.occurredAtIso,
      input.ciphertext,
      input.epoch
    ]
  );
}

/**
 * @openapi
 * /mls/groups/{groupId}/messages:
 *   post:
 *     summary: Send encrypted message to MLS group
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
 *     responses:
 *       201:
 *         description: Message sent
 */
const postGroupsGroupidMessagesHandler = async (
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

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const groupEpochResult = await pool.query<{ current_epoch: number }>(
      `SELECT current_epoch
         FROM mls_groups
        WHERE id = $1
        LIMIT 1`,
      [groupId]
    );
    const currentEpoch = groupEpochResult.rows[0]?.current_epoch;
    if (typeof currentEpoch !== 'number') {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (payload.epoch !== currentEpoch) {
      res.status(409).json({ error: 'Epoch mismatch' });
      return;
    }

    // Insert message with atomic sequence number assignment
    // Uses subquery to avoid race condition on concurrent inserts
    const id = randomUUID();
    const result = await pool.query<{
      sequence_number: number;
      created_at: Date;
    }>(
      `INSERT INTO mls_messages (
          id, group_id, sender_user_id, epoch, ciphertext, message_type, content_type, sequence_number, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          COALESCE((SELECT MAX(sequence_number) FROM mls_messages WHERE group_id = $2), 0) + 1,
          NOW()
        )
        RETURNING sequence_number, created_at`,
      [
        id,
        groupId,
        claims.sub,
        payload.epoch,
        payload.ciphertext,
        payload.messageType,
        payload.contentType ?? 'text/plain'
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert message');
    }

    const message: MlsMessage = {
      id,
      groupId,
      senderUserId: claims.sub,
      epoch: payload.epoch,
      ciphertext: payload.ciphertext,
      messageType: payload.messageType,
      contentType: payload.contentType ?? 'text/plain',
      sequenceNumber: row.sequence_number,
      sentAt: row.created_at.toISOString(),
      createdAt: row.created_at.toISOString()
    };

    if (payload.messageType === 'application') {
      try {
        await mirrorApplicationMessageToVfs({
          messageId: id,
          groupId,
          senderUserId: claims.sub,
          organizationId: membership.organizationId,
          ciphertext: payload.ciphertext,
          epoch: payload.epoch,
          occurredAtIso: row.created_at.toISOString()
        });
      } catch (mirrorError) {
        console.warn(
          `Failed to mirror MLS message ${id} for group ${groupId} into VFS:`,
          mirrorError
        );
      }
    }

    // Broadcast to group channel
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:message',
      payload: message,
      timestamp: row.created_at.toISOString()
    });

    const response: SendMlsMessageResponse = { message };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to send message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

export function registerPostGroupsGroupidMessagesRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/groups/:groupId/messages',
    postGroupsGroupidMessagesHandler
  );
}
