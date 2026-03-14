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
  type AclTargetState,
  isAclOperation,
  logAclMutationAudit
} from './vfsDirectCrdtPushAclGuardrails.js';
import {
  type ApplyAclAuthorizationInfo,
  parseAccessRank,
  prepareAclOperation
} from './vfsDirectCrdtPushAclPreflight.js';
import { buildAclAuditEntry } from './vfsDirectCrdtPushAclValidation.js';
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
  access_rank: number | string | null;
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
  const authorizedItemIds = new Set<string>();
  const itemOwnersById = new Map<string, ItemOwnerRow>();
  const actorAccessRanksByItemId = new Map<string, number>();
  const aclTargetStateCache = new Map<string, AclTargetState>();
  const validOperations: VfsCrdtPushOperation[] = [];
  for (const entry of input.parsedOperations) {
    if (entry.status === 'parsed' && entry.operation) {
      validOperations.push(entry.operation);
    }
  }

  const itemAuthInfo = new Map<string, ApplyAclAuthorizationInfo>();
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

    // Track owner_id per item for ACL validation even if actor is not the owner
    const itemOwnerIds = new Map<string, string | null>();
    for (const row of itemRows.rows) {
      itemOwnerIds.set(row.id, row.owner_id);
      itemOwnersById.set(row.id, row);
      if (
        row.owner_id === input.userId &&
        row.organization_id === input.organizationId
      ) {
        itemAuthInfo.set(row.id, {
          isOwner: true,
          accessRank: 3,
          ownerId: row.owner_id
        });
        authorizedItemIds.add(row.id);
        actorAccessRanksByItemId.set(row.id, 3);
      }
    }

    const visibilityRows = await runQuery<EffectiveVisibilityRow>(
      'authorized_item_lookup',
      `
      SELECT item_id, access_rank
      FROM vfs_effective_visibility
      WHERE user_id = $1::uuid
        AND item_id = ANY($2::uuid[])
      `,
      [input.userId, uniqueItemIds]
    );
    for (const row of visibilityRows.rows) {
      const itemId = normalizeRequiredString(row.item_id);
      const accessRank = parseAccessRank(row.access_rank);
      if (itemId) {
        const existing = itemAuthInfo.get(itemId);
        if (!existing || accessRank > existing.accessRank) {
          itemAuthInfo.set(itemId, {
            isOwner: existing?.isOwner ?? false,
            accessRank,
            ownerId: itemOwnerIds.get(itemId) ?? null
          });
        }
        const currentAccessRank = actorAccessRanksByItemId.get(itemId) ?? 0;
        if (accessRank > currentAccessRank) {
          actorAccessRanksByItemId.set(itemId, accessRank);
        }
      }
      if (itemId && accessRank >= 2) {
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
    const authInfo = itemAuthInfo.get(operation.itemId);
    let operationToPersist = operation;
    const recordAclAudit = (
      status: VfsCrdtPushResult['status'],
      reason?: string
    ): void => {
      if (!isAclOperation(operation)) {
        return;
      }

      logAclMutationAudit({
        actorId: input.userId,
        organizationId: input.organizationId,
        operation: operationToPersist,
        reason: reason ?? null,
        status
      });
    };
    if (!authorizedItemIds.has(operation.itemId)) {
      results.push({
        opId: operation.opId,
        status: 'invalidOp'
      });
      recordAclAudit('invalidOp', 'item_not_authorized');
      continue;
    }

    if (!authInfo) {
      results.push({
        opId: operation.opId,
        status: 'invalidOp'
      });
      recordAclAudit('invalidOp', 'item_auth_missing');
      continue;
    }

    if (isAclOperation(operation)) {
      const preparedAclOperation = await prepareAclOperation({
        aclTargetStateCache,
        actorAccessRanksByItemId,
        actorId: input.userId,
        authInfo,
        itemOwnersById,
        operation,
        runQuery
      });
      if (preparedAclOperation.kind === 'denied') {
        if (preparedAclOperation.warningEntry) {
          console.warn(
            'ACL operation denied:',
            preparedAclOperation.warningEntry
          );
        }
        results.push({
          opId: operation.opId,
          status: preparedAclOperation.resultStatus
        });
        recordAclAudit(
          preparedAclOperation.resultStatus,
          preparedAclOperation.auditReason
        );
        continue;
      }

      operationToPersist = preparedAclOperation.operationToPersist;
    }

    const sourceId = toPushSourceId(input.userId, operationToPersist);
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
        replicaWriteHeads.get(operationToPersist.replicaId) ?? 0;
      if (operationToPersist.writeId > existingReplicaWriteId) {
        replicaWriteHeads.set(
          operationToPersist.replicaId,
          operationToPersist.writeId
        );
        maxOccurredAt = pickNewerOccurredAt(maxOccurredAt, existingOccurredAt);
        await upsertReplicaHead(
          runQuery,
          input.userId,
          operationToPersist.replicaId,
          operationToPersist.writeId,
          existingOccurredAt
        );
      }

      results.push({
        opId: operationToPersist.opId,
        status: 'alreadyApplied'
      });
      recordAclAudit('alreadyApplied');
      continue;
    }

    const maxWriteId = replicaWriteHeads.get(operationToPersist.replicaId) ?? 0;
    if (operationToPersist.writeId <= maxWriteId) {
      results.push({
        opId: operationToPersist.opId,
        status: 'staleWriteId'
      });
      recordAclAudit('staleWriteId');
      continue;
    }

    const canonicalOccurredAt = normalizeCanonicalOccurredAt(
      operationToPersist.occurredAt,
      maxOccurredAt
    );
    const encryptedPayload = serializeEnvelopeField(
      operationToPersist.encryptedPayload
    );
    const encryptionNonce = serializeEnvelopeField(
      operationToPersist.encryptionNonce
    );
    const encryptionAad = serializeEnvelopeField(
      operationToPersist.encryptionAad
    );
    const encryptionSignature = serializeEnvelopeField(
      operationToPersist.encryptionSignature
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
        operationToPersist.itemId,
        operationToPersist.opType,
        operationToPersist.principalType ?? null,
        operationToPersist.principalId ?? null,
        operationToPersist.accessLevel ?? null,
        operationToPersist.parentId ?? null,
        operationToPersist.childId ?? null,
        input.userId,
        CRDT_CLIENT_PUSH_SOURCE_TABLE,
        sourceId,
        canonicalOccurredAt,
        encryptedPayload.text,
        operationToPersist.keyEpoch ?? null,
        encryptionNonce.text,
        encryptionAad.text,
        encryptionSignature.text,
        encryptedPayload.bytes,
        encryptionNonce.bytes,
        encryptionAad.bytes,
        encryptionSignature.bytes,
        resolveContainerId(operationToPersist)
      ]
    );

    const applied = (insertResult.rowCount ?? 0) > 0;
    if (applied) {
      const insertedRow = insertResult.rows?.[0];
      const insertedOccurredAt =
        insertedRow?.occurred_at ?? canonicalOccurredAt;
      maxOccurredAt = pickNewerOccurredAt(maxOccurredAt, insertedOccurredAt);
      replicaWriteHeads.set(
        operationToPersist.replicaId,
        operationToPersist.writeId
      );
      await upsertReplicaHead(
        runQuery,
        input.userId,
        operationToPersist.replicaId,
        operationToPersist.writeId,
        insertedOccurredAt
      );

      const containerId = resolveContainerId(operationToPersist);
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

      await applyCanonicalItemOperation(
        runQuery,
        input.userId,
        operationToPersist
      );

      if (isAclOperation(operation)) {
        console.warn(
          'ACL operation applied:',
          buildAclAuditEntry(operationToPersist, input.userId, 'applied')
        );
      }
    }

    results.push({
      opId: operationToPersist.opId,
      status: applied ? 'applied' : 'outdatedOp'
    });
    recordAclAudit(applied ? 'applied' : 'outdatedOp');
  }

  return {
    results,
    notifications: Array.from(containerNotifications.values()),
    queryMetrics
  };
}
