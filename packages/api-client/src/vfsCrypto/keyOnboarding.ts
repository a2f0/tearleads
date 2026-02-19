import type { VfsKeySetupRequest } from '@tearleads/shared';
import {
  buildVfsPublicEncryptionKey,
  decryptVfsPrivateKeysWithPassword,
  encryptVfsPrivateKeysWithPassword,
  generateKeyPair,
  reconstructVfsKeyPair,
  serializeKeyPair,
  type VfsKeyPair
} from '@tearleads/shared';

function assertNonEmptyPassword(password: string): void {
  if (password.trim().length === 0) {
    throw new Error('password is required');
  }
}

export interface VfsOnboardingKeyBundle {
  keyPair: VfsKeyPair;
  setupPayload: VfsKeySetupRequest;
}

/**
 * Create a VFS key setup payload suitable for POST /vfs/keys.
 *
 * Private keys are serialized and encrypted client-side with a password-derived
 * key. The salt is returned in the argon2Salt field for backwards-compatible
 * storage in existing server schema.
 */
export async function createVfsOnboardingKeyBundle(
  password: string
): Promise<VfsOnboardingKeyBundle> {
  assertNonEmptyPassword(password);

  const keyPair = generateKeyPair();
  const serialized = serializeKeyPair(keyPair);
  const encryptedBundle = await encryptVfsPrivateKeysWithPassword(
    serialized,
    password
  );

  return {
    keyPair,
    setupPayload: {
      publicEncryptionKey: buildVfsPublicEncryptionKey(keyPair),
      publicSigningKey: '',
      encryptedPrivateKeys: encryptedBundle.encryptedPrivateKeys,
      argon2Salt: encryptedBundle.argon2Salt
    }
  };
}

/**
 * Decrypt a VFS private key bundle from /vfs/keys response fields.
 */
export async function decryptVfsPrivateKeyBundle(
  password: string,
  encryptedPrivateKeysBase64: string,
  argon2SaltBase64: string,
  publicEncryptionKey: {
    x25519PublicKey: string;
    mlKemPublicKey: string;
  }
): Promise<VfsKeyPair> {
  assertNonEmptyPassword(password);
  const privateKeys = await decryptVfsPrivateKeysWithPassword(
    encryptedPrivateKeysBase64,
    argon2SaltBase64,
    password
  );

  return reconstructVfsKeyPair(publicEncryptionKey, privateKeys);
}
