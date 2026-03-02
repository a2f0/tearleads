import type {
  VfsCrdtPushOperation,
  VfsCrdtPushResult
} from '@tearleads/shared';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import {
  createVfsCrdtQueryMetrics,
  runTimedVfsCrdtQuery,
  type VfsCrdtQueryMetrics
} from '../../lib/vfsCrdtPerformanceMetrics.js';
import { toIsoString } from './crdtRouteHelpers.js';
import {
  CRDT_CLIENT_PUSH_SOURCE_TABLE,
  type MaxWriteIdRow,
  normalizeCanonicalOccurredAt,
  parseMaxWriteId,
  toPushSourceId
} from './post-crdt-push-canonical.js';
import type { ParsedPushOperation } from './post-crdt-push-parse.js';

interface ItemOwnerRow {
  id: string;
  owner_id: string | null;
}
interface ExistingSourceRow {
  id: string;
  occurred_at: Date | string;
}
interface ReplicaWriteHeadRow extends MaxWriteIdRow {
  replica_id: string | null;
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
  queryMetrics: VfsCrdtQueryMetrics;
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

function normalizeReplicaId(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickNewerOccurredAt(
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

type TimedQueryRunner = <T extends QueryResultRow>(
  label: string,
  text: string,
  values?: unknown[]
) => Promise<QueryResult<T>>;

async function upsertReplicaHead(
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
      $1::text,
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

async function applyCanonicalItemOperation(
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

    await runQuery(
      'canonical_sync_change_upsert',
      `SELECT vfs_emit_sync_change($1::text, 'upsert', $2::text, NULL)`,
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

    await runQuery(
      'canonical_sync_change_delete',
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
  const queryMetrics = createVfsCrdtQueryMetrics();
  const runQuery: TimedQueryRunner = async <T extends QueryResultRow>(
    label: string,
    text: string,
    values?: unknown[]
  ) =>
    runTimedVfsCrdtQuery(label, queryMetrics, () =>
      input.client.query<T>(text, values)
    );

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
    const itemRows = await runQuery<ItemOwnerRow>(
      'owner_lookup',
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

  const hasOwnedValidOperation = input.parsedOperations.some(
    (entry) =>
      entry.status === 'parsed' &&
      !!entry.operation &&
      ownerByItemId.get(entry.operation.itemId) === input.userId
  );

  const replicaWriteHeads = new Map<string, number>();
  let maxOccurredAt: string | null = null;

  if (hasOwnedValidOperation) {
    await runQuery(
      'advisory_lock',
      'SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [`vfs_crdt_feed:${input.userId}`]
    );

    const replicaHeadResult = await runQuery<ReplicaWriteHeadRow>(
      'replica_heads_lookup',
      `
      SELECT
        replica_id,
        max_write_id,
        max_occurred_at
      FROM vfs_crdt_replica_heads
      WHERE actor_id = $1::text
      `,
      [input.userId]
    );

    for (const row of replicaHeadResult.rows) {
      const replicaId = normalizeReplicaId(row.replica_id);
      if (!replicaId) {
        continue;
      }

      const maxWriteId = parseMaxWriteId(row);
      if (maxWriteId > 0) {
        replicaWriteHeads.set(replicaId, maxWriteId);
      }
      maxOccurredAt = pickNewerOccurredAt(maxOccurredAt, row.max_occurred_at);
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

    const sourceId = toPushSourceId(input.userId, operation);
    const existing = await runQuery<ExistingSourceRow>(
      'existing_source_lookup',
      `
      SELECT id, occurred_at
      FROM vfs_crdt_ops
      WHERE source_table = $1
        AND source_id = $2
      LIMIT 1
      `,
      [CRDT_CLIENT_PUSH_SOURCE_TABLE, sourceId]
    );
    if (existing.rows[0]) {
      const existingOccurredAt = existing.rows[0].occurred_at;
      const existingReplicaWriteId =
        replicaWriteHeads.get(operation.replicaId) ?? 0;
      if (operation.writeId > existingReplicaWriteId) {
        replicaWriteHeads.set(operation.replicaId, operation.writeId);
        maxOccurredAt = pickNewerOccurredAt(maxOccurredAt, existingOccurredAt);
        await upsertReplicaHead(
          runQuery,
          input.userId,
          operation.replicaId,
          operation.writeId,
          existingOccurredAt
        );
      }

      results.push({
        opId: operation.opId,
        status: 'alreadyApplied'
      });
      continue;
    }

    const maxWriteId = replicaWriteHeads.get(operation.replicaId) ?? 0;
    if (operation.writeId <= maxWriteId) {
      results.push({
        opId: operation.opId,
        status: 'staleWriteId'
      });
      continue;
    }

    const canonicalOccurredAt = normalizeCanonicalOccurredAt(
      operation.occurredAt,
      maxOccurredAt
    );
    const insertResult = await runQuery<InsertedCrdtOpRow>(
      'insert_crdt_op',
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
      const insertedOccurredAt =
        insertedRow?.occurred_at ?? canonicalOccurredAt;
      maxOccurredAt = pickNewerOccurredAt(maxOccurredAt, insertedOccurredAt);
      replicaWriteHeads.set(operation.replicaId, operation.writeId);
      await upsertReplicaHead(
        runQuery,
        input.userId,
        operation.replicaId,
        operation.writeId,
        insertedOccurredAt
      );

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

      await applyCanonicalItemOperation(runQuery, input.userId, operation);
    }

    results.push({
      opId: operation.opId,
      status: applied ? 'applied' : 'outdatedOp'
    });
  }

  return {
    results,
    notifications: Array.from(containerNotifications.values()),
    queryMetrics
  };
}
