import type {
  VfsCrdtPushOperation,
  VfsCrdtPushResult
} from '@tearleads/shared';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  createVfsCrdtQueryMetrics,
  runTimedVfsCrdtQuery,
  type VfsCrdtQueryMetrics
} from '../../lib/vfsCrdtPerformanceMetrics.js';
import { normalizeRequiredString } from './vfsDirectBlobShared.js';
import { serializeEnvelopeField } from './vfsDirectCrdtEnvelopeStorage.js';
import {
  applyCanonicalItemOperation,
  compareCursor,
  pickNewerOccurredAt,
  resolveContainerId,
  type TimedQueryRunner,
  upsertReplicaHead,
  type VfsContainerCursorNotification
} from './vfsDirectCrdtPushApplyHelpers.js';
import {
  CRDT_CLIENT_PUSH_SOURCE_TABLE,
  type MaxWriteIdRow,
  normalizeCanonicalOccurredAt,
  parseMaxWriteId,
  toPushSourceId
} from './vfsDirectCrdtPushCanonical.js';
import type { ParsedPushOperation } from './vfsDirectCrdtPushParse.js';
import { toIsoString } from './vfsDirectCrdtRouteHelpers.js';

interface ItemOwnerRow {
  id: string;
  owner_id: string | null;
  organization_id: string | null;
}
interface EffectiveVisibilityRow {
  item_id: string | null;
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
interface ApplyCrdtPushOperationsResult {
  results: VfsCrdtPushResult[];
  notifications: VfsContainerCursorNotification[];
  queryMetrics: VfsCrdtQueryMetrics;
}

export async function applyCrdtPushOperations(input: {
  client: Pick<PoolClient, 'query'>;
  userId: string;
  organizationId: string;
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

  const authorizedItemIds = new Set<string>();
  if (validOperations.length > 0) {
    const uniqueItemIds = Array.from(
      new Set(validOperations.map((operation) => operation.itemId))
    );
    const itemRows = await runQuery<ItemOwnerRow>(
      'owner_lookup',
      `
      SELECT id, owner_id, organization_id
      FROM vfs_registry
      WHERE id = ANY($1::uuid[])
      `,
      [uniqueItemIds]
    );
    for (const row of itemRows.rows) {
      if (
        row.owner_id === input.userId &&
        row.organization_id === input.organizationId
      ) {
        authorizedItemIds.add(row.id);
      }
    }

    const visibilityRows = await runQuery<EffectiveVisibilityRow>(
      'authorized_item_lookup',
      `
      SELECT item_id
      FROM vfs_effective_visibility
      WHERE user_id = $1::uuid
        AND item_id = ANY($2::uuid[])
        AND access_rank >= 2
      `,
      [input.userId, uniqueItemIds]
    );
    for (const row of visibilityRows.rows) {
      const itemId = normalizeRequiredString(row.item_id);
      if (itemId) {
        authorizedItemIds.add(itemId);
      }
    }
  }

  const hasAuthorizedValidOperation = input.parsedOperations.some(
    (entry) =>
      entry.status === 'parsed' &&
      !!entry.operation &&
      authorizedItemIds.has(entry.operation.itemId)
  );

  const replicaWriteHeads = new Map<string, number>();
  let maxOccurredAt: string | null = null;

  if (hasAuthorizedValidOperation) {
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
      WHERE actor_id = $1::uuid
      `,
      [input.userId]
    );

    for (const row of replicaHeadResult.rows) {
      const replicaId = normalizeRequiredString(row.replica_id);
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
    if (!authorizedItemIds.has(operation.itemId)) {
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
    const encryptedPayload = serializeEnvelopeField(operation.encryptedPayload);
    const encryptionNonce = serializeEnvelopeField(operation.encryptionNonce);
    const encryptionAad = serializeEnvelopeField(operation.encryptionAad);
    const encryptionSignature = serializeEnvelopeField(
      operation.encryptionSignature
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
        encryption_signature,
        encrypted_payload_bytes,
        encryption_nonce_bytes,
        encryption_aad_bytes,
        encryption_signature_bytes,
        root_id
      ) VALUES (
        vfs_make_event_id('crdt'),
        $1::uuid,
        $2::text,
        $3::text,
        $4::uuid,
        $5::text,
        $6::uuid,
        $7::uuid,
        $8::uuid,
        $9::text,
        $10::text,
        $11::timestamptz,
        $12::text,
        $13::integer,
        $14::text,
        $15::text,
        $16::text,
        $17::bytea,
        $18::bytea,
        $19::bytea,
        $20::bytea,
        $21::uuid
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
        encryptedPayload.text,
        operation.keyEpoch ?? null,
        encryptionNonce.text,
        encryptionAad.text,
        encryptionSignature.text,
        encryptedPayload.bytes,
        encryptionNonce.bytes,
        encryptionAad.bytes,
        encryptionSignature.bytes,
        resolveContainerId(operation)
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
