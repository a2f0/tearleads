import { createHash, randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import { decodeBase64ToBytes, encodeBytesToBase64 } from './mlsBinaryCodec.js';
import type {
  MlsBinaryGroupState,
  MlsBinaryGroupStateResponse,
  UploadMlsStateBinaryRequest,
  UploadMlsStateBinaryResponse
} from './mlsBinaryTypes.js';
import { requireMlsClaims } from './mlsDirectAuth.js';
import { encoded, toIsoString } from './mlsDirectCommon.js';
import { acquireTransactionClient } from './mlsDirectMessagesShared.js';
import { getActiveMlsGroupMembership } from './mlsDirectShared.js';

type GroupIdRequest = { groupId: string };
type GroupIdTypedStateRequest = {
  groupId: string;
} & UploadMlsStateBinaryRequest;

function sha256Base64(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('base64');
}

export async function uploadGroupStateDirectTyped(
  request: GroupIdTypedStateRequest,
  context: { requestHeader: Headers }
): Promise<UploadMlsStateBinaryResponse> {
  const groupId = request.groupId.trim();
  if (groupId.length === 0) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  const claims = await requireMlsClaims(
    `/mls/groups/${encoded(groupId)}/state`,
    context.requestHeader
  );

  const payload: UploadMlsStateBinaryRequest = {
    epoch: request.epoch,
    encryptedState: Uint8Array.from(request.encryptedState),
    stateHash: request.stateHash.trim()
  };
  if (
    !Number.isInteger(payload.epoch) ||
    payload.epoch < 0 ||
    payload.encryptedState.byteLength === 0 ||
    payload.stateHash.length === 0
  ) {
    throw new ConnectError('Invalid state payload', Code.InvalidArgument);
  }

  const computedStateHash = sha256Base64(payload.encryptedState);
  if (computedStateHash !== payload.stateHash) {
    throw new ConnectError('State hash mismatch', Code.InvalidArgument);
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
    let state: MlsBinaryGroupState | null = null;

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
        throw new ConnectError(
          'State epoch is ahead of group epoch',
          Code.AlreadyExists
        );
      }

      const id = randomUUID();
      const result = await client.query<{
        id: string;
        created_at: Date | string;
      }>(
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
          encodeBytesToBase64(payload.encryptedState),
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

    return { state };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to upload state:', error);
    throw new ConnectError('Failed to upload state', Code.Internal);
  }
}

export async function getGroupStateDirectTyped(
  request: GroupIdRequest,
  context: { requestHeader: Headers }
): Promise<MlsBinaryGroupStateResponse> {
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
      throw new ConnectError(
        'Not a member of this group',
        Code.PermissionDenied
      );
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
      return { state: null };
    }

    const decodedState = decodeBase64ToBytes(row.encrypted_state);
    if (!decodedState) {
      throw new ConnectError(
        'Stored MLS state is not valid base64',
        Code.Internal
      );
    }
    const computedStateHash = sha256Base64(decodedState);
    if (computedStateHash !== row.state_hash) {
      throw new ConnectError('Stored MLS state hash mismatch', Code.Internal);
    }

    const state: MlsBinaryGroupState = {
      id: row.id,
      groupId: row.group_id,
      epoch: row.epoch,
      encryptedState: decodedState,
      stateHash: row.state_hash,
      createdAt: toIsoString(row.created_at)
    };

    return { state };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get state:', error);
    throw new ConnectError('Failed to get state', Code.Internal);
  }
}
