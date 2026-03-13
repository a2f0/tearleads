import type { VfsCrdtPushOperation } from '@tearleads/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import { toIsoString } from './vfsDirectCrdtRouteHelpers.js';

export interface VfsContainerCursorNotification {
  containerId: string;
  changedAt: string;
  changeId: string;
}

export function compareCursor(
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

export function resolveContainerId(
  operation: VfsCrdtPushOperation
): string | null {
  if (
    operation.opType === 'link_add' ||
    operation.opType === 'link_remove' ||
    operation.opType === 'link_reassign'
  ) {
    const parentId = operation.parentId?.trim();
    return parentId && parentId.length > 0 ? parentId : null;
  }
  const itemId = operation.itemId.trim();
  return itemId.length > 0 ? itemId : null;
}

export function pickNewerOccurredAt(
  current: string | null,
  candidate: Date | string | null
): string | null {
  if (!candidate) {
    return current;
  }
  const candidateIso = toIsoString(candidate);
  if (!candidateIso) {
    return current;
  }
  if (!current) {
    return candidateIso;
  }
  return Date.parse(candidateIso) > Date.parse(current)
    ? candidateIso
    : current;
}

export type TimedQueryRunner = <T extends QueryResultRow>(
  label: string,
  text: string,
  values?: unknown[]
) => Promise<QueryResult<T>>;

export async function upsertReplicaHead(
  runQuery: TimedQueryRunner,
  actorId: string,
  replicaId: string,
  writeId: number,
  occurredAt: Date | string
): Promise<void> {
  await runQuery(
    'replica_head_upsert',
    `
    INSERT INTO vfs_crdt_replica_heads (
      actor_id,
      replica_id,
      max_write_id,
      max_occurred_at,
      updated_at
    ) VALUES (
      $1::uuid,
      $2::text,
      $3::bigint,
      $4::timestamptz,
      NOW()
    )
    ON CONFLICT (actor_id, replica_id) DO UPDATE
    SET
      max_write_id = GREATEST(
        vfs_crdt_replica_heads.max_write_id,
        EXCLUDED.max_write_id
      ),
      max_occurred_at = GREATEST(
        vfs_crdt_replica_heads.max_occurred_at,
        EXCLUDED.max_occurred_at
      ),
      updated_at = NOW()
    `,
    [actorId, replicaId, writeId, occurredAt]
  );
}

export async function applyCanonicalItemOperation(
  runQuery: TimedQueryRunner,
  actorId: string,
  operation: VfsCrdtPushOperation
): Promise<void> {
  if (operation.opType === 'item_upsert') {
    await runQuery(
      'canonical_item_upsert',
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
        $1::uuid,
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

    await runQuery(
      'canonical_sync_change_upsert',
      `SELECT vfs_emit_sync_change($1::uuid, 'upsert', $2::uuid, NULL)`,
      [operation.itemId, actorId]
    );
    return;
  }

  if (operation.opType === 'item_delete') {
    await runQuery(
      'canonical_item_delete',
      `
      INSERT INTO vfs_item_state (
        item_id,
        updated_at,
        deleted_at
      ) VALUES (
        $1::uuid,
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

    await runQuery(
      'canonical_sync_change_delete',
      `SELECT vfs_emit_sync_change($1::uuid, 'delete', $2::uuid, NULL)`,
      [operation.itemId, actorId]
    );
  }
}
