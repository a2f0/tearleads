import { Code, ConnectError } from '@connectrpc/connect';
import type {
  VfsKeySetupRequest,
  VfsUserKeysResponse,
  VfsUserSigningKeyResponse
} from '@tearleads/shared';
import { buildVfsV2ConnectMethodPath } from '@tearleads/shared';
import { getPostgresPool } from '../../lib/postgres.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import { parseKeySetupPayload } from './vfsDirectShared.js';

interface UserKeysRow {
  public_encryption_key: string;
  public_signing_key: string;
  encrypted_private_keys: string | null;
  argon2_salt: string | null;
}

export async function getMyKeysDirect(
  _request: object,
  context: { requestHeader: Headers }
): Promise<VfsUserKeysResponse> {
  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('GetMyKeys'),
    context.requestHeader
  );

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<UserKeysRow>(
      `SELECT public_encryption_key,
              public_signing_key,
              encrypted_private_keys,
              argon2_salt
       FROM user_keys
       WHERE user_id = $1`,
      [claims.sub]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('VFS keys not set up', Code.NotFound);
    }

    const response: VfsUserKeysResponse = {
      publicEncryptionKey: row.public_encryption_key,
      publicSigningKey: row.public_signing_key,
      ...(row.encrypted_private_keys === null
        ? {}
        : { encryptedPrivateKeys: row.encrypted_private_keys }),
      ...(row.argon2_salt === null ? {} : { argon2Salt: row.argon2_salt })
    };

    return response;
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get VFS keys:', error);
    throw new ConnectError('Failed to get VFS keys', Code.Internal);
  }
}

export async function getUserSigningKeyDirect(
  request: { userId?: string | undefined },
  context: { requestHeader: Headers }
): Promise<VfsUserSigningKeyResponse> {
  await requireVfsClaims(
    buildVfsV2ConnectMethodPath('GetUserSigningKey'),
    context.requestHeader
  );

  const userId =
    typeof request.userId === 'string' ? request.userId.trim() : '';
  if (
    !userId ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u.test(
      userId
    )
  ) {
    throw new ConnectError(
      'A valid userId (UUID) is required',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{ public_signing_key: string }>(
      `SELECT public_signing_key
       FROM user_keys
       WHERE user_id = $1`,
      [userId]
    );

    const row = result.rows[0];
    if (!row || !row.public_signing_key) {
      throw new ConnectError('Signing key not found for user', Code.NotFound);
    }

    return {
      userId,
      publicSigningKey: row.public_signing_key
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get user signing key:', error);
    throw new ConnectError('Failed to get user signing key', Code.Internal);
  }
}

export async function setupKeysDirect(
  request: VfsKeySetupRequest,
  context: { requestHeader: Headers }
): Promise<{ created: boolean }> {
  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('SetupKeys'),
    context.requestHeader
  );
  const payload = parseKeySetupPayload(request);
  if (!payload) {
    throw new ConnectError(
      'publicEncryptionKey, publicSigningKey, encryptedPrivateKeys, and argon2Salt are required',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();

    const existing = await pool.query(
      'SELECT 1 FROM user_keys WHERE user_id = $1',
      [claims.sub]
    );
    if (existing.rows.length > 0) {
      throw new ConnectError(
        'VFS keys already exist for this user',
        Code.AlreadyExists
      );
    }

    await pool.query(
      `INSERT INTO user_keys (
        user_id,
        public_encryption_key,
        public_signing_key,
        encrypted_private_keys,
        argon2_salt,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        claims.sub,
        payload.publicEncryptionKey,
        payload.publicSigningKey,
        payload.encryptedPrivateKeys,
        payload.argon2Salt
      ]
    );

    return { created: true };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to set up VFS keys:', error);
    throw new ConnectError('Failed to set up VFS keys', Code.Internal);
  }
}
