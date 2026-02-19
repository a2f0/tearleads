import {
  combinePublicKey,
  deserializeKeyPair,
  type SerializedKeyPair,
  serializeKeyPair,
  type VfsKeyPair
} from './asymmetric.js';
import {
  decrypt,
  deriveKeyFromPassword,
  encrypt,
  generateSalt,
  importKey
} from './webCrypto.js';

const PRIVATE_KEYS_AAD = new TextEncoder().encode('tearleads-vfs-keys:v1');
const PRIVATE_KEYS_VERSION = 'v1';

interface SerializedPrivateKeyBundleV1 {
  version: 'v1';
  x25519PrivateKey: string;
  mlKemPrivateKey: string;
}

export interface VfsEncryptedPrivateKeyBundle {
  encryptedPrivateKeys: string;
  argon2Salt: string;
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function serializePrivateKeyBundle(
  serialized: SerializedKeyPair
): SerializedPrivateKeyBundleV1 {
  return {
    version: PRIVATE_KEYS_VERSION,
    x25519PrivateKey: serialized.x25519PrivateKey,
    mlKemPrivateKey: serialized.mlKemPrivateKey
  };
}

function parsePrivateKeyBundle(
  value: unknown
): SerializedPrivateKeyBundleV1 | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record['version'] !== PRIVATE_KEYS_VERSION ||
    typeof record['x25519PrivateKey'] !== 'string' ||
    typeof record['mlKemPrivateKey'] !== 'string'
  ) {
    return null;
  }

  return {
    version: PRIVATE_KEYS_VERSION,
    x25519PrivateKey: record['x25519PrivateKey'],
    mlKemPrivateKey: record['mlKemPrivateKey']
  };
}

async function encryptPrivateKeysWithCryptoKey(
  serialized: SerializedKeyPair,
  key: CryptoKey
): Promise<VfsEncryptedPrivateKeyBundle> {
  const plaintext = new TextEncoder().encode(
    JSON.stringify(serializePrivateKeyBundle(serialized))
  );
  const encryptedBlob = await encrypt(plaintext, key, PRIVATE_KEYS_AAD);
  return {
    encryptedPrivateKeys: toBase64(encryptedBlob),
    argon2Salt: toBase64(generateSalt())
  };
}

export async function encryptVfsPrivateKeysWithPassword(
  serialized: SerializedKeyPair,
  password: string
): Promise<VfsEncryptedPrivateKeyBundle> {
  if (password.trim().length === 0) {
    throw new Error('password is required');
  }
  const salt = generateSalt();
  const key = await deriveKeyFromPassword(password, salt);
  const plaintext = new TextEncoder().encode(
    JSON.stringify(serializePrivateKeyBundle(serialized))
  );
  const encryptedBlob = await encrypt(plaintext, key, PRIVATE_KEYS_AAD);
  return {
    encryptedPrivateKeys: toBase64(encryptedBlob),
    argon2Salt: toBase64(salt)
  };
}

export async function encryptVfsPrivateKeysWithRawKey(
  serialized: SerializedKeyPair,
  keyBytes: Uint8Array
): Promise<VfsEncryptedPrivateKeyBundle> {
  const key = await importKey(keyBytes);
  return encryptPrivateKeysWithCryptoKey(serialized, key);
}

export async function decryptVfsPrivateKeysWithPassword(
  encryptedPrivateKeysBase64: string,
  argon2SaltBase64: string,
  password: string
): Promise<{
  x25519PrivateKey: string;
  mlKemPrivateKey: string;
}> {
  if (password.trim().length === 0) {
    throw new Error('password is required');
  }
  const salt = fromBase64(argon2SaltBase64);
  const encryptedBlob = fromBase64(encryptedPrivateKeysBase64);
  const key = await deriveKeyFromPassword(password, salt);
  const plaintext = await decrypt(encryptedBlob, key, PRIVATE_KEYS_AAD);
  const parsed = parsePrivateKeyBundle(
    JSON.parse(new TextDecoder().decode(plaintext)) as unknown
  );
  if (!parsed) {
    throw new Error('invalid VFS private key bundle');
  }
  return {
    x25519PrivateKey: parsed.x25519PrivateKey,
    mlKemPrivateKey: parsed.mlKemPrivateKey
  };
}

export async function decryptVfsPrivateKeysWithRawKey(
  encryptedPrivateKeysBase64: string,
  keyBytes: Uint8Array
): Promise<{
  x25519PrivateKey: string;
  mlKemPrivateKey: string;
}> {
  const encryptedBlob = fromBase64(encryptedPrivateKeysBase64);
  const key = await importKey(keyBytes);
  const plaintext = await decrypt(encryptedBlob, key, PRIVATE_KEYS_AAD);
  const parsed = parsePrivateKeyBundle(
    JSON.parse(new TextDecoder().decode(plaintext)) as unknown
  );
  if (!parsed) {
    throw new Error('invalid VFS private key bundle');
  }
  return {
    x25519PrivateKey: parsed.x25519PrivateKey,
    mlKemPrivateKey: parsed.mlKemPrivateKey
  };
}

export function buildVfsPublicEncryptionKey(keyPair: VfsKeyPair): string {
  const serialized = serializeKeyPair(keyPair);
  return combinePublicKey({
    x25519PublicKey: serialized.x25519PublicKey,
    mlKemPublicKey: serialized.mlKemPublicKey
  });
}

export function reconstructVfsKeyPair(
  publicEncryptionKey: { x25519PublicKey: string; mlKemPublicKey: string },
  privateKeys: { x25519PrivateKey: string; mlKemPrivateKey: string }
): VfsKeyPair {
  return deserializeKeyPair({
    x25519PublicKey: publicEncryptionKey.x25519PublicKey,
    mlKemPublicKey: publicEncryptionKey.mlKemPublicKey,
    x25519PrivateKey: privateKeys.x25519PrivateKey,
    mlKemPrivateKey: privateKeys.mlKemPrivateKey
  });
}
