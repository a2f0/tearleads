import type {
  VfsCrdtPushOperation,
  VfsCrdtPushResponse,
  VfsCrdtPushResult
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { publishVfsContainerCursorBump } from '../../lib/vfsSyncChannels.js';
import {
  CRDT_CLIENT_PUSH_SOURCE_TABLE,
  type MaxWriteIdRow,
  normalizeCanonicalOccurredAt,
  parseMaxWriteId,
  toPushSourceId,
  toReplicaPrefix
} from './post-crdt-push-canonical.js';
import { parsePushPayload } from './post-crdt-push-parse.js';

interface ItemOwnerRow {
  id: string;
  owner_id: string | null;
}

interface ExistingSourceRow {
  id: string;
}

interface InsertedCrdtOpRow {
  id: string;
  occurred_at: Date | string;
}

interface VfsContainerCursorNotification {
  containerId: string;
  changedAt: string;
  changeId: string;
}

function toIsoString(value: Date | string): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function compareCursor(
  left: Pick<VfsContainerCursorNotification, 'changedAt' | 'changeId'>,
  right: Pick<VfsContainerCursorNotification, 'changedAt' | 'changeId'>
): number {
  const leftMs = Date.parse(left.changedAt);
  const rightMs = Date.parse(right.changedAt);

  if (leftMs < rightMs) {
    return -1;
  }
  if (leftMs > rightMs) {
    return 1;
  }

  return left.changeId.localeCompare(right.changeId);
}

function resolveContainerId(operation: VfsCrdtPushOperation): string | null {
  if (operation.opType === 'link_add' || operation.opType === 'link_remove') {
    const parentId = operation.parentId?.trim();
    return parentId && parentId.length > 0 ? parentId : null;
  }

  const itemId = operation.itemId.trim();
  return itemId.length > 0 ? itemId : null;
}

async function applyCanonicalItemOperation(
  client: PoolClient,
  actorId: string,
  operation: VfsCrdtPushOperation
): Promise<void> {
  if (operation.opType === 'item_upsert') {
    await client.query(
      `
      INSERT INTO vfs_item_state (
        item_id,
        encrypted_payload,
        key_epoch,
        encryption_nonce,
        encryption_aad,
        encryption_signature,
        updated_at,
        deleted_at
      ) VALUES (
        $1::text,
        $2::text,
        $3::integer,
        $4::text,
        $5::text,
        $6::text,
        NOW(),
        NULL
      )
      ON CONFLICT (item_id) DO UPDATE
      SET
        encrypted_payload = EXCLUDED.encrypted_payload,
        key_epoch = EXCLUDED.key_epoch,
        encryption_nonce = EXCLUDED.encryption_nonce,
        encryption_aad = EXCLUDED.encryption_aad,
        encryption_signature = EXCLUDED.encryption_signature,
        updated_at = NOW(),
        deleted_at = NULL
      `,
      [
        operation.itemId,
        operation.encryptedPayload ?? null,
        operation.keyEpoch ?? null,
        operation.encryptionNonce ?? null,
        operation.encryptionAad ?? null,
        operation.encryptionSignature ?? null
      ]
    );

    await client.query(
      `SELECT vfs_emit_sync_change($1::text, 'upsert', $2::text, NULL)`,
      [operation.itemId, actorId]
    );
    return;
  } else if (operation.opType === 'item_delete') {
    await client.query(
      `
      INSERT INTO vfs_item_state (
        item_id,
        updated_at,
        deleted_at
      ) VALUES (
        $1::text,
        NOW(),
        NOW()
      )
      ON CONFLICT (item_id) DO UPDATE
      SET
        updated_at = NOW(),
        deleted_at = NOW()
      `,
      [operation.itemId]
    );

    await client.query(
      `SELECT vfs_emit_sync_change($1::text, 'delete', $2::text, NULL)`,
      [operation.itemId, actorId]
    );
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}

/**
 * @openapi
 * /vfs/crdt/push:
 *   post:
 *     summary: Push client-authored CRDT operations
 *     description: Accepts CRDT operations from a client replica and returns per-op acknowledgements.
 *     tags:
 *       - VFS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - operations
 *             properties:
 *               clientId:
 *                 type: string
 *               operations:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: |
 *           Per-op push acknowledgement results.
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const postCrdtPushHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsedPayload = parsePushPayload(req.body);
  if (!parsedPayload.ok) {
    res.status(400).json({ error: parsedPayload.error });
    return;
  }

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const results: VfsCrdtPushResult[] = [];
    const containerNotifications = new Map<
      string,
      VfsContainerCursorNotification
    >();
    const parsedOperations = parsedPayload.value.operations;
    const validOperations: VfsCrdtPushOperation[] = [];
    for (const entry of parsedOperations) {
      if (entry.status === 'parsed' && entry.operation) {
        validOperations.push(entry.operation);
      }
    }

    const ownerByItemId = new Map<string, string | null>();
    if (validOperations.length > 0) {
      const uniqueItemIds = Array.from(
        new Set(validOperations.map((operation) => operation.itemId))
      );

      const itemRows = await client.query<ItemOwnerRow>(
        `
        SELECT id, owner_id
        FROM vfs_registry
        WHERE id = ANY($1::text[])
        `,
        [uniqueItemIds]
      );
      for (const row of itemRows.rows) {
        ownerByItemId.set(row.id, row.owner_id);
      }
    }

    for (const entry of parsedOperations) {
      if (entry.status !== 'parsed' || !entry.operation) {
        results.push({
          opId: entry.opId,
          status: 'invalidOp'
        });
        continue;
      }

      const operation = entry.operation;
      if (ownerByItemId.get(operation.itemId) !== claims.sub) {
        results.push({
          opId: operation.opId,
          status: 'invalidOp'
        });
        continue;
      }

      // Guardrail: serialize writes per user feed so canonical `occurred_at`
      // never regresses across replicas, preserving cursor safety.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
        `vfs_crdt_feed:${claims.sub}`
      ]);

      const sourceId = toPushSourceId(claims.sub, operation);
      const existing = await client.query<ExistingSourceRow>(
        `
        SELECT id
        FROM vfs_crdt_ops
        WHERE source_table = $1
          AND source_id = $2
        LIMIT 1
        `,
        [CRDT_CLIENT_PUSH_SOURCE_TABLE, sourceId]
      );
      if (existing.rows[0]) {
        results.push({
          opId: operation.opId,
          status: 'alreadyApplied'
        });
        continue;
      }

      const maxWriteResult = await client.query<MaxWriteIdRow>(
        `
        SELECT
          COALESCE(
            MAX(
              CASE
                WHEN position($3 in source_id) = 1
                  AND NULLIF(split_part(source_id, ':', 3), '') ~ '^[0-9]+$'
                  THEN split_part(source_id, ':', 3)::bigint
                ELSE NULL
              END
            ),
            0
          ) AS max_write_id,
          MAX(occurred_at) AS max_occurred_at
        FROM vfs_crdt_ops
        WHERE source_table = $1
          AND actor_id = $2
        `,
        [
          CRDT_CLIENT_PUSH_SOURCE_TABLE,
          claims.sub,
          toReplicaPrefix(claims.sub, operation.replicaId)
        ]
      );

      const maxWriteRow = maxWriteResult.rows[0];
      const maxWriteId = parseMaxWriteId(maxWriteRow);
      if (operation.writeId <= maxWriteId) {
        results.push({
          opId: operation.opId,
          status: 'staleWriteId'
        });
        continue;
      }

      const canonicalOccurredAt = normalizeCanonicalOccurredAt(
        operation.occurredAt,
        maxWriteRow?.max_occurred_at ?? null
      );

      const insertResult = await client.query<InsertedCrdtOpRow>(
        `
        INSERT INTO vfs_crdt_ops (
          id,
          item_id,
          op_type,
          principal_type,
          principal_id,
          access_level,
          parent_id,
          child_id,
          actor_id,
          source_table,
          source_id,
          occurred_at,
          encrypted_payload,
          key_epoch,
          encryption_nonce,
          encryption_aad,
          encryption_signature
        ) VALUES (
          vfs_make_event_id('crdt'),
          $1::text,
          $2::text,
          $3::text,
          $4::text,
          $5::text,
          $6::text,
          $7::text,
          $8::text,
          $9::text,
          $10::text,
          $11::timestamptz,
          $12::text,
          $13::integer,
          $14::text,
          $15::text,
          $16::text
        )
        RETURNING id, occurred_at
        `,
        [
          operation.itemId,
          operation.opType,
          operation.principalType ?? null,
          operation.principalId ?? null,
          operation.accessLevel ?? null,
          operation.parentId ?? null,
          operation.childId ?? null,
          claims.sub,
          CRDT_CLIENT_PUSH_SOURCE_TABLE,
          sourceId,
          canonicalOccurredAt,
          operation.encryptedPayload ?? null,
          operation.keyEpoch ?? null,
          operation.encryptionNonce ?? null,
          operation.encryptionAad ?? null,
          operation.encryptionSignature ?? null
        ]
      );

      const applied = (insertResult.rowCount ?? 0) > 0;
      if (applied) {
        const insertedRow = insertResult.rows?.[0];
        const containerId = resolveContainerId(operation);
        const changedAt = insertedRow
          ? toIsoString(insertedRow.occurred_at)
          : null;
        const changeId = insertedRow?.id?.trim() ?? '';
        if (containerId && changedAt && changeId.length > 0) {
          const nextNotification: VfsContainerCursorNotification = {
            containerId,
            changedAt,
            changeId
          };
          const existingNotification = containerNotifications.get(containerId);
          if (
            !existingNotification ||
            compareCursor(nextNotification, existingNotification) > 0
          ) {
            containerNotifications.set(containerId, nextNotification);
          }
        }

        await applyCanonicalItemOperation(client, claims.sub, operation);
      }

      results.push({
        opId: operation.opId,
        status: applied ? 'applied' : 'outdatedOp'
      });
    }

    await client.query('COMMIT');
    inTransaction = false;

    const response: VfsCrdtPushResponse = {
      clientId: parsedPayload.value.clientId,
      results
    };

    for (const notification of containerNotifications.values()) {
      try {
        await publishVfsContainerCursorBump({
          containerId: notification.containerId,
          changedAt: notification.changedAt,
          changeId: notification.changeId,
          actorId: claims.sub,
          sourceClientId: parsedPayload.value.clientId
        });
      } catch (publishError) {
        console.error('Failed to publish VFS container cursor bump:', {
          containerId: notification.containerId,
          error: publishError
        });
      }
    }

    res.status(200).json(response);
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    console.error('Failed to push VFS CRDT operations:', error);
    res.status(500).json({ error: 'Failed to push CRDT operations' });
  } finally {
    client.release();
  }
};

export function registerPostCrdtPushRoute(routeRouter: RouterType): void {
  routeRouter.post('/crdt/push', postCrdtPushHandler);
}
