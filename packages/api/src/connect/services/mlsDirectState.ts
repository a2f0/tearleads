import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  MlsGroupState,
  MlsGroupStateResponse,
  UploadMlsStateResponse
} from '@tearleads/shared';
import type { QueryResultRow } from 'pg';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import {
  getActiveMlsGroupMembership,
  parseUploadStatePayload
} from '../../routes/mls/shared.js';
import { requireMlsClaims } from './mlsDirectAuth.js';

type GroupIdRequest = { groupId: string };
type GroupIdJsonRequest = { groupId: string; json: string };

interface QueryClient {
  query: <T extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
  release: () => void;
}

function parseJsonBody(json: string): unknown {
  const normalized = json.trim().length > 0 ? json : '{}';

  try {
    return JSON.parse(normalized);
  } catch {
    throw new ConnectError('Invalid JSON body', Code.InvalidArgument);
  }
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
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

export async function uploadGroupStateDirect(
  request: GroupIdJsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}/state`,
    context.requestHeader
  );

  const payload = parseUploadStatePayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError('Invalid state payload', Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      throw new ConnectError('Not a member of this group', Code.PermissionDenied);
    }

    const client = await acquireTransactionClient(pool);
    let state: MlsGroupState | null = null;

    try {
      await client.query('BEGIN');

      const groupEpochResult = await client.query<{ current_epoch: number }>(
        `SELECT current_epoch
           FROM mls_groups
          WHERE id = $1
          LIMIT 1
          FOR SHARE`,
        [groupId]
      );
      const currentEpoch = groupEpochResult.rows[0]?.current_epoch;
      if (typeof currentEpoch !== 'number') {
        throw new ConnectError('Group not found', Code.NotFound);
      }

      if (payload.epoch > currentEpoch) {
        throw new ConnectError('State epoch is ahead of group epoch', Code.AlreadyExists);
      }

      const id = randomUUID();
      const result = await client.query<{ id: string; created_at: Date | string }>(
        `INSERT INTO mls_group_state (
           id,
           group_id,
           user_id,
           epoch,
           encrypted_state,
           state_hash,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (group_id, user_id) DO UPDATE SET
           id = EXCLUDED.id,
           epoch = EXCLUDED.epoch,
           encrypted_state = EXCLUDED.encrypted_state,
           state_hash = EXCLUDED.state_hash,
           created_at = NOW()
         WHERE mls_group_state.epoch <= EXCLUDED.epoch
         RETURNING id, created_at`,
        [
          id,
          groupId,
          claims.sub,
          payload.epoch,
          payload.encryptedState,
          payload.stateHash
        ]
      );

      const row = result.rows[0];
      if (!row) {
        throw new ConnectError(
          'State with a newer epoch already exists',
          Code.AlreadyExists
        );
      }

      state = {
        id: row.id,
        groupId,
        epoch: payload.epoch,
        encryptedState: payload.encryptedState,
        stateHash: payload.stateHash,
        createdAt: toIsoString(row.created_at)
      };

      await client.query('COMMIT');
    } catch (transactionError) {
      await client.query('ROLLBACK').catch(() => {});
      throw transactionError;
    } finally {
      client.release();
    }

    if (!state) {
      throw new ConnectError('Failed to upload state', Code.Internal);
    }

    const response: UploadMlsStateResponse = { state };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to upload state:', error);
    throw new ConnectError('Failed to upload state', Code.Internal);
  }
}

export async function getGroupStateDirect(
  request: GroupIdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}/state`,
    context.requestHeader
  );

  try {
    const pool = await getPool('read');

    const membership = await getActiveMlsGroupMembership(groupId, claims.sub);
    if (!membership) {
      throw new ConnectError('Not a member of this group', Code.PermissionDenied);
    }

    const result = await pool.query<{
      id: string;
      group_id: string;
      epoch: number;
      encrypted_state: string;
      state_hash: string;
      created_at: Date | string;
    }>(
      `SELECT id, group_id, epoch, encrypted_state, state_hash, created_at
       FROM mls_group_state
       WHERE group_id = $1 AND user_id = $2
       ORDER BY epoch DESC
       LIMIT 1`,
      [groupId, claims.sub]
    );

    const row = result.rows[0];
    if (!row) {
      const response: MlsGroupStateResponse = { state: null };
      return { json: JSON.stringify(response) };
    }

    const state: MlsGroupState = {
      id: row.id,
      groupId: row.group_id,
      epoch: row.epoch,
      encryptedState: row.encrypted_state,
      stateHash: row.state_hash,
      createdAt: toIsoString(row.created_at)
    };

    const response: MlsGroupStateResponse = { state };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get state:', error);
    throw new ConnectError('Failed to get state', Code.Internal);
  }
}
