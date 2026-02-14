import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushOperation,
  VfsCrdtPushResponse,
  VfsCrdtPushResult
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';

const MAX_CLIENT_ID_LENGTH = 128;
const MAX_PUSH_OPERATIONS = 500;
const CRDT_CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';

const VALID_OP_TYPES: VfsCrdtOpType[] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove'
];
const VALID_PRINCIPAL_TYPES: VfsAclPrincipalType[] = [
  'user',
  'group',
  'organization'
];
const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];

interface ParsedPushOperation {
  status: 'parsed' | 'invalid';
  opId: string;
  operation?: VfsCrdtPushOperation;
}

interface ParsedPushPayload {
  clientId: string;
  operations: ParsedPushOperation[];
}

type ParsePushPayloadResult =
  | { ok: true; value: ParsedPushPayload }
  | { ok: false; error: string };

interface ItemOwnerRow {
  id: string;
  owner_id: string | null;
}

interface ExistingSourceRow {
  id: string;
}

interface MaxWriteIdRow {
  max_write_id: number | string | null;
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidOpType(value: unknown): value is VfsCrdtOpType {
  return (
    typeof value === 'string' && VALID_OP_TYPES.some((candidate) => candidate === value)
  );
}

function isValidPrincipalType(value: unknown): value is VfsAclPrincipalType {
  return (
    typeof value === 'string' &&
    VALID_PRINCIPAL_TYPES.some((candidate) => candidate === value)
  );
}

function isValidAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return (
    typeof value === 'string' &&
    VALID_ACCESS_LEVELS.some((candidate) => candidate === value)
  );
}

function normalizeWriteId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return value;
}

function normalizeOccurredAt(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized) {
    return null;
  }

  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function parseClientId(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_CLIENT_ID_LENGTH || normalized.includes(':')) {
    return null;
  }

  return normalized;
}

function parsePushOperation(
  value: unknown,
  index: number,
  expectedClientId: string
): ParsedPushOperation {
  if (!isRecord(value)) {
    return {
      status: 'invalid',
      opId: `invalid-${index}`
    };
  }

  const opId = normalizeRequiredString(value['opId']) ?? `invalid-${index}`;
  const opType = value['opType'];
  const itemId = normalizeRequiredString(value['itemId']);
  const replicaId = parseClientId(value['replicaId']);
  const writeId = normalizeWriteId(value['writeId']);
  const occurredAt = normalizeOccurredAt(value['occurredAt']);

  if (
    !isValidOpType(opType) ||
    !itemId ||
    !replicaId ||
    !writeId ||
    !occurredAt ||
    replicaId !== expectedClientId
  ) {
    return {
      status: 'invalid',
      opId
    };
  }

  const operation: VfsCrdtPushOperation = {
    opId,
    opType,
    itemId,
    replicaId,
    writeId,
    occurredAt
  };

  if (opType === 'acl_add' || opType === 'acl_remove') {
    const principalType = value['principalType'];
    const principalId = normalizeRequiredString(value['principalId']);
    if (!isValidPrincipalType(principalType) || !principalId) {
      return {
        status: 'invalid',
        opId
      };
    }

    operation.principalType = principalType;
    operation.principalId = principalId;

    if (opType === 'acl_add') {
      const accessLevel = value['accessLevel'];
      if (!isValidAccessLevel(accessLevel)) {
        return {
          status: 'invalid',
          opId
        };
      }

      operation.accessLevel = accessLevel;
    }
  }

  if (opType === 'link_add' || opType === 'link_remove') {
    const parentId = normalizeRequiredString(value['parentId']);
    const childId = normalizeRequiredString(value['childId']) ?? itemId;
    if (!parentId || !childId) {
      return {
        status: 'invalid',
        opId
      };
    }

    operation.parentId = parentId;
    operation.childId = childId;
  }

  return {
    status: 'parsed',
    opId,
    operation
  };
}

function parsePushPayload(body: unknown): ParsePushPayloadResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      error: 'clientId and operations are required'
    };
  }

  const clientId = parseClientId(body['clientId']);
  if (!clientId) {
    return {
      ok: false,
      error: 'clientId must be non-empty, <=128 chars, and must not contain ":"'
    };
  }

  const rawOperations = body['operations'];
  if (!Array.isArray(rawOperations)) {
    return {
      ok: false,
      error: 'operations must be an array'
    };
  }

  if (rawOperations.length > MAX_PUSH_OPERATIONS) {
    return {
      ok: false,
      error: `operations exceeds max entries (${MAX_PUSH_OPERATIONS})`
    };
  }

  const operations = rawOperations.map((entry, index) =>
    parsePushOperation(entry, index, clientId)
  );

  return {
    ok: true,
    value: {
      clientId,
      operations
    }
  };
}

function toPushSourceId(userId: string, operation: VfsCrdtPushOperation): string {
  return `${userId}:${operation.replicaId}:${operation.writeId}:${operation.opId}`;
}

function toReplicaPrefix(userId: string, replicaId: string): string {
  return `${userId}:${replicaId}:`;
}

function parseMaxWriteId(row: MaxWriteIdRow | undefined): number {
  if (!row) {
    return 0;
  }

  const value = row.max_write_id;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
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
 *         description: Per-op push acknowledgement results
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
export const postCrdtPushHandler = async (req: Request, res: Response) => {
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

      // Guardrail: serialize writes per (user, replica) so stale-write checks
      // and inserts are strongly ordered under concurrent pushes.
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [`${claims.sub}:${operation.replicaId}`]
      );

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
        SELECT COALESCE(
          MAX(NULLIF(split_part(source_id, ':', 3), '')::bigint),
          0
        ) AS max_write_id
        FROM vfs_crdt_ops
        WHERE source_table = $1
          AND actor_id = $2
          AND position($3 in source_id) = 1
        `,
        [
          CRDT_CLIENT_PUSH_SOURCE_TABLE,
          claims.sub,
          toReplicaPrefix(claims.sub, operation.replicaId)
        ]
      );

      const maxWriteId = parseMaxWriteId(maxWriteResult.rows[0]);
      if (operation.writeId <= maxWriteId) {
        results.push({
          opId: operation.opId,
          status: 'staleWriteId'
        });
        continue;
      }

      const insertResult = await client.query(
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
          occurred_at
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
          $11::timestamptz
        )
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
          operation.occurredAt
        ]
      );

      results.push({
        opId: operation.opId,
        status: (insertResult.rowCount ?? 0) > 0 ? 'applied' : 'outdatedOp'
      });
    }

    await client.query('COMMIT');
    inTransaction = false;

    const response: VfsCrdtPushResponse = {
      clientId: parsedPayload.value.clientId,
      results
    };
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
