import type { TestContext } from '@tearleads/api-test-utils';

interface VfsKeyActor {
  alias: string;
  user: { userId: string };
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

function createVfsKeyPayload(keyPrefix: string): {
  publicEncryptionKey: string;
  publicSigningKey: string;
  encryptedPrivateKeys: string;
  argon2Salt: string;
} {
  return {
    publicEncryptionKey: `${keyPrefix}-public-enc-key`,
    publicSigningKey: `${keyPrefix}-public-sign-key`,
    encryptedPrivateKeys: `${keyPrefix}-encrypted-private-keys`,
    argon2Salt: `${keyPrefix}-argon2-salt`
  };
}

function isMissingKeyFieldsError(
  status: number,
  responseBody: string
): boolean {
  return (
    status === 400 &&
    responseBody.includes(
      'publicEncryptionKey, publicSigningKey, encryptedPrivateKeys, and argon2Salt are required'
    )
  );
}

export async function ensureVfsKeysExist(input: {
  ctx: TestContext;
  actor: VfsKeyActor;
  keyPrefix: string;
}): Promise<void> {
  const payload = createVfsKeyPayload(input.keyPrefix);
  const response = await input.actor.fetch('/vfs/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (response.status === 201 || response.status === 409) {
    return;
  }

  const responseBody = await response.text();
  if (isMissingKeyFieldsError(response.status, responseBody)) {
    await input.ctx.pool.query(
      `INSERT INTO user_keys (
         user_id,
         public_encryption_key,
         public_signing_key,
         encrypted_private_keys,
         argon2_salt,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [
        input.actor.user.userId,
        payload.publicEncryptionKey,
        payload.publicSigningKey,
        payload.encryptedPrivateKeys,
        payload.argon2Salt
      ]
    );
    return;
  }

  throw new Error(
    `Failed to set up VFS keys for ${input.actor.alias}: ${String(response.status)} ${response.statusText}: ${responseBody}`
  );
}
