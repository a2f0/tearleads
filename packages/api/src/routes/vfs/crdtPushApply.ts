import type {
  VfsCrdtPushOperation,
  VfsCrdtPushResult
} from '@tearleads/shared';
import type { PoolClient } from 'pg';
import { toIsoString } from './crdtRouteHelpers.js';
import {
  CRDT_CLIENT_PUSH_SOURCE_TABLE,
  type MaxWriteIdRow,
  normalizeCanonicalOccurredAt,
  parseMaxWriteId,
  toPushSourceId,
  toReplicaPrefix
} from './post-crdt-push-canonical.js';
import type { ParsedPushOperation } from './post-crdt-push-parse.js';

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

interface ApplyCrdtPushOperationsResult {
  results: VfsCrdtPushResult[];
  notifications: VfsContainerCursorNotification[];
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
  }

  if (operation.opType === 'item_delete') {
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

export async function applyCrdtPushOperations(input: {
  client: PoolClient;
  userId: string;
  parsedOperations: ParsedPushOperation[];
}): Promise<ApplyCrdtPushOperationsResult> {
  const results: VfsCrdtPushResult[] = [];
  const containerNotifications = new Map<
    string,
    VfsContainerCursorNotification
  >();
  const validOperations: VfsCrdtPushOperation[] = [];
  for (const entry of input.parsedOperations) {
    if (entry.status === 'parsed' && entry.operation) {
      validOperations.push(entry.operation);
    }
  }

  const ownerByItemId = new Map<string, string | null>();
  if (validOperations.length > 0) {
    const uniqueItemIds = Array.from(
      new Set(validOperations.map((operation) => operation.itemId))
    );
    const itemRows = await input.client.query<ItemOwnerRow>(
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

  for (const entry of input.parsedOperations) {
    if (entry.status !== 'parsed' || !entry.operation) {
      results.push({
        opId: entry.opId,
        status: 'invalidOp'
      });
      continue;
    }

    const operation = entry.operation;
    if (ownerByItemId.get(operation.itemId) !== input.userId) {
      results.push({
        opId: operation.opId,
        status: 'invalidOp'
      });
      continue;
    }

    await input.client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [`vfs_crdt_feed:${input.userId}`]
    );

    const sourceId = toPushSourceId(input.userId, operation);
    const existing = await input.client.query<ExistingSourceRow>(
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

    const maxWriteResult = await input.client.query<MaxWriteIdRow>(
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
        input.userId,
        toReplicaPrefix(input.userId, operation.replicaId)
      ]
    );

    const maxWriteRow = maxWriteResult.rows[0];
    if (operation.writeId <= parseMaxWriteId(maxWriteRow)) {
      results.push({
        opId: operation.opId,
        status: 'staleWriteId'
      });
      continue;
    }

    const insertResult = await input.client.query<InsertedCrdtOpRow>(
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
        input.userId,
        CRDT_CLIENT_PUSH_SOURCE_TABLE,
        sourceId,
        normalizeCanonicalOccurredAt(
          operation.occurredAt,
          maxWriteRow?.max_occurred_at ?? null
        ),
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

      await applyCanonicalItemOperation(input.client, input.userId, operation);
    }

    results.push({
      opId: operation.opId,
      status: applied ? 'applied' : 'outdatedOp'
    });
  }

  return {
    results,
    notifications: Array.from(containerNotifications.values())
  };
}
