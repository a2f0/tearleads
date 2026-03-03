import { Code, ConnectError } from '@connectrpc/connect';
import type { VfsUserKeysResponse } from '@tearleads/shared';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseKeySetupPayload } from '../../routes/vfs/shared.js';
import { parseJsonBody } from './vfsDirectJson.js';
import { requireVfsClaims } from './vfsDirectAuth.js';

type JsonRequest = { json: string };

interface UserKeysRow {
  public_encryption_key: string;
  public_signing_key: string;
  encrypted_private_keys: string;
  argon2_salt: string;
}

export async function getMyKeysDirect(
  _request: object,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsClaims('/vfs/keys/me', context.requestHeader);

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
      encryptedPrivateKeys: row.encrypted_private_keys,
      argon2Salt: row.argon2_salt
    };

    return {
      json: JSON.stringify(response)
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get VFS keys:', error);
    throw new ConnectError('Failed to get VFS keys', Code.Internal);
  }
}

export async function setupKeysDirect(
  request: JsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsClaims('/vfs/keys', context.requestHeader);
  const payload = parseKeySetupPayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError(
      'publicEncryptionKey, publicSigningKey, encryptedPrivateKeys, and argon2Salt are required',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();

    const existing = await pool.query('SELECT 1 FROM user_keys WHERE user_id = $1', [
      claims.sub
    ]);
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

    return {
      json: JSON.stringify({ created: true })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to set up VFS keys:', error);
    throw new ConnectError('Failed to set up VFS keys', Code.Internal);
  }
}
