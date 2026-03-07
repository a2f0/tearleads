import { Code, ConnectError } from '@connectrpc/connect';
import type {
  VfsRegisterResponse,
  VfsRekeyRequest,
  VfsRekeyResponse
} from '@tearleads/shared';
import { getPostgresPool } from '../../lib/postgres.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import { encoded, isRecord, parseJsonBody } from './vfsDirectJson.js';
import { parseRegisterPayload } from './vfsDirectShared.js';

type JsonRequest = { json: string };
type ItemIdJsonRequest = { itemId: string; json: string };

type RekeyReason = 'unshare' | 'expiry' | 'manual';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidRekeyReason(value: unknown): value is RekeyReason {
  return value === 'unshare' || value === 'expiry' || value === 'manual';
}

function parseRekeyPayload(body: unknown): VfsRekeyRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const reason = body['reason'];
  const newEpochValue = body['newEpoch'];
  const wrappedKeysValue = body['wrappedKeys'];

  if (
    !isValidRekeyReason(reason) ||
    typeof newEpochValue !== 'number' ||
    !Number.isInteger(newEpochValue) ||
    !Number.isSafeInteger(newEpochValue) ||
    newEpochValue < 1 ||
    !Array.isArray(wrappedKeysValue)
  ) {
    return null;
  }

  const wrappedKeys: VfsRekeyRequest['wrappedKeys'] = [];
  for (const wrappedKeyValue of wrappedKeysValue) {
    if (!isRecord(wrappedKeyValue)) {
      return null;
    }

    const recipientUserId = wrappedKeyValue['recipientUserId'];
    const recipientPublicKeyId = wrappedKeyValue['recipientPublicKeyId'];
    const keyEpochValue = wrappedKeyValue['keyEpoch'];
    const encryptedKey = wrappedKeyValue['encryptedKey'];
    const senderSignature = wrappedKeyValue['senderSignature'];

    if (
      !isNonEmptyString(recipientUserId) ||
      !isNonEmptyString(recipientPublicKeyId) ||
      typeof keyEpochValue !== 'number' ||
      !Number.isInteger(keyEpochValue) ||
      !Number.isSafeInteger(keyEpochValue) ||
      keyEpochValue < 1 ||
      !isNonEmptyString(encryptedKey) ||
      !isNonEmptyString(senderSignature)
    ) {
      return null;
    }

    if (keyEpochValue !== newEpochValue) {
      return null;
    }

    wrappedKeys.push({
      recipientUserId,
      recipientPublicKeyId,
      keyEpoch: keyEpochValue,
      encryptedKey,
      senderSignature
    });
  }

  return {
    reason,
    newEpoch: newEpochValue,
    wrappedKeys
  };
}

export async function registerDirect(
  request: JsonRequest,
  context: { requestHeader: Headers }
): Promise<VfsRegisterResponse> {
  const claims = await requireVfsClaims(
    '/vfs/register',
    context.requestHeader,
    {
      requireDeclaredOrganization: true
    }
  );
  const payload = parseRegisterPayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError(
      'id, objectType, and encryptedSessionKey are required',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();

    const existing = await pool.query(
      'SELECT 1 FROM vfs_registry WHERE id = $1',
      [payload.id]
    );
    if (existing.rows.length > 0) {
      throw new ConnectError(
        'Item already registered in VFS',
        Code.AlreadyExists
      );
    }

    const result = await pool.query<{ created_at: Date }>(
      `INSERT INTO vfs_registry (
        id,
        object_type,
        owner_id,
        organization_id,
        encrypted_session_key,
        encrypted_name,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING created_at`,
      [
        payload.id,
        payload.objectType,
        claims.sub,
        claims.organizationId,
        payload.encryptedSessionKey,
        payload.encryptedName ?? null
      ]
    );

    const createdAt = result.rows[0]?.created_at;
    return {
      id: payload.id,
      createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to register VFS item:', error);
    throw new ConnectError('Failed to register VFS item', Code.Internal);
  }
}

export async function rekeyItemDirect(
  request: ItemIdJsonRequest,
  context: { requestHeader: Headers }
): Promise<VfsRekeyResponse> {
  const itemId = request.itemId.trim();
  if (itemId.length === 0) {
    throw new ConnectError('itemId is required', Code.InvalidArgument);
  }

  const claims = await requireVfsClaims(
    `/vfs/items/${encoded(itemId)}/rekey`,
    context.requestHeader,
    { requireDeclaredOrganization: true }
  );

  const payload = parseRekeyPayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError(
      'Invalid request payload. Please check the `reason`, `newEpoch`, and `wrappedKeys` fields.',
      Code.InvalidArgument
    );
  }

  const rekeyablePrincipalTypes = ['user', 'group', 'organization'];

  try {
    const pool = await getPostgresPool();
    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query('BEGIN');
      transactionOpen = true;

      const itemResult = await client.query<{
        id: string;
        owner_id: string | null;
      }>('SELECT id, owner_id FROM vfs_registry WHERE id = $1 FOR UPDATE', [
        itemId
      ]);
      const item = itemResult.rows[0];

      if (!item) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        throw new ConnectError('Item not found', Code.NotFound);
      }

      if (item.owner_id !== claims.sub) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        throw new ConnectError(
          'Not authorized to rekey this item',
          Code.PermissionDenied
        );
      }

      const wrappedKeyMetadata: string[] = [];
      for (const wrappedKey of payload.wrappedKeys) {
        wrappedKeyMetadata.push(
          JSON.stringify({
            recipientPublicKeyId: wrappedKey.recipientPublicKeyId,
            senderSignature: wrappedKey.senderSignature
          })
        );
      }

      const updateResult = await client.query(
        `WITH input_rows AS (
           SELECT recipient_user_id, wrapped_session_key, wrapped_hierarchical_key, key_epoch
           FROM UNNEST(
             $1::text[],
             $2::text[],
             $3::text[],
             $4::int4[]
           ) AS rekey_rows(
             recipient_user_id,
             wrapped_session_key,
             wrapped_hierarchical_key,
             key_epoch
           )
         )
         UPDATE vfs_acl_entries AS acl
         SET wrapped_session_key = input_rows.wrapped_session_key,
             wrapped_hierarchical_key = input_rows.wrapped_hierarchical_key,
             key_epoch = input_rows.key_epoch,
             updated_at = NOW()
         FROM input_rows
         WHERE acl.item_id = $5
           AND acl.principal_id = input_rows.recipient_user_id
           AND acl.principal_type = ANY($6::text[])
           AND acl.revoked_at IS NULL
         RETURNING acl.id`,
        [
          payload.wrappedKeys.map((wrappedKey) => wrappedKey.recipientUserId),
          payload.wrappedKeys.map((wrappedKey) => wrappedKey.encryptedKey),
          wrappedKeyMetadata,
          payload.wrappedKeys.map((wrappedKey) => wrappedKey.keyEpoch),
          itemId,
          rekeyablePrincipalTypes
        ]
      );

      await client.query('COMMIT');
      transactionOpen = false;

      const response: VfsRekeyResponse = {
        itemId,
        newEpoch: payload.newEpoch,
        wrapsApplied: updateResult.rowCount ?? 0
      };

      return response;
    } catch (transactionError) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(
            'Failed to rollback VFS rekey transaction:',
            rollbackError
          );
        }
      }
      throw transactionError;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to rekey VFS item:', error);
    throw new ConnectError('Failed to rekey VFS item', Code.Internal);
  }
}
