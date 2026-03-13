import { ed25519 } from '@noble/curves/ed25519.js';
import {
  combinePublicKey,
  deserializeKeyPair,
  type SerializedKeyPair,
  serializeKeyPair,
  type VfsKeyPair
} from './asymmetric.js';
import {
  decrypt,
  deriveKeyFromPasswordMaterial,
  encrypt,
  generateSalt,
  importKey,
  importPasswordKeyMaterial
} from './webCrypto.js';

const PRIVATE_KEYS_AAD = new TextEncoder().encode('tearleads-vfs-keys:v1');
const PRIVATE_KEYS_VERSION = 'v2';

interface SerializedPrivateKeyBundleV2 {
  version: 'v2';
  x25519PrivateKey: string;
  mlKemPrivateKey: string;
  ed25519PrivateKey: string;
}

interface ParsedPrivateKeyBundle {
  x25519PrivateKey: string;
  mlKemPrivateKey: string;
  ed25519PrivateKey: string | null;
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
): SerializedPrivateKeyBundleV2 {
  return {
    version: PRIVATE_KEYS_VERSION,
    x25519PrivateKey: serialized.x25519PrivateKey,
    mlKemPrivateKey: serialized.mlKemPrivateKey,
    ed25519PrivateKey: serialized.ed25519PrivateKey
  };
}

function parsePrivateKeyBundle(value: unknown): ParsedPrivateKeyBundle | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const version = record['version'];
  if (
    (version !== 'v1' && version !== 'v2') ||
    typeof record['x25519PrivateKey'] !== 'string' ||
    typeof record['mlKemPrivateKey'] !== 'string'
  ) {
    return null;
  }

  const ed25519PrivateKey =
    version === 'v2' && typeof record['ed25519PrivateKey'] === 'string'
      ? record['ed25519PrivateKey']
      : null;

  return {
    x25519PrivateKey: record['x25519PrivateKey'],
    mlKemPrivateKey: record['mlKemPrivateKey'],
    ed25519PrivateKey
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
  const passwordMaterial = await importVfsPrivateKeyPasswordMaterial(password);
  return encryptVfsPrivateKeysWithPasswordMaterial(
    serialized,
    passwordMaterial
  );
}

export async function importVfsPrivateKeyPasswordMaterial(
  password: string
): Promise<CryptoKey> {
  if (password.trim().length === 0) {
    throw new Error('password is required');
  }
  return importPasswordKeyMaterial(password);
}

export async function encryptVfsPrivateKeysWithPasswordMaterial(
  serialized: SerializedKeyPair,
  passwordMaterial: CryptoKey
): Promise<VfsEncryptedPrivateKeyBundle> {
  const salt = generateSalt();
  const key = await deriveKeyFromPasswordMaterial(passwordMaterial, salt);
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
  ed25519PrivateKey: string | null;
}> {
  const passwordMaterial = await importVfsPrivateKeyPasswordMaterial(password);
  return decryptVfsPrivateKeysWithPasswordMaterial(
    encryptedPrivateKeysBase64,
    argon2SaltBase64,
    passwordMaterial
  );
}

export async function decryptVfsPrivateKeysWithPasswordMaterial(
  encryptedPrivateKeysBase64: string,
  argon2SaltBase64: string,
  passwordMaterial: CryptoKey
): Promise<{
  x25519PrivateKey: string;
  mlKemPrivateKey: string;
  ed25519PrivateKey: string | null;
}> {
  const salt = fromBase64(argon2SaltBase64);
  const encryptedBlob = fromBase64(encryptedPrivateKeysBase64);
  const key = await deriveKeyFromPasswordMaterial(passwordMaterial, salt);
  const plaintext = await decrypt(encryptedBlob, key, PRIVATE_KEYS_AAD);
  const parsed = parsePrivateKeyBundle(
    JSON.parse(new TextDecoder().decode(plaintext)) as unknown
  );
  if (!parsed) {
    throw new Error('invalid VFS private key bundle');
  }
  return {
    x25519PrivateKey: parsed.x25519PrivateKey,
    mlKemPrivateKey: parsed.mlKemPrivateKey,
    ed25519PrivateKey: parsed.ed25519PrivateKey
  };
}

export async function decryptVfsPrivateKeysWithRawKey(
  encryptedPrivateKeysBase64: string,
  keyBytes: Uint8Array
): Promise<{
  x25519PrivateKey: string;
  mlKemPrivateKey: string;
  ed25519PrivateKey: string | null;
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
    mlKemPrivateKey: parsed.mlKemPrivateKey,
    ed25519PrivateKey: parsed.ed25519PrivateKey
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
  privateKeys: {
    x25519PrivateKey: string;
    mlKemPrivateKey: string;
    ed25519PrivateKey?: string | null;
  }
): VfsKeyPair {
  let ed25519PublicKeyBase64: string;
  let ed25519PrivateKeyBase64: string;

  if (privateKeys.ed25519PrivateKey) {
    ed25519PrivateKeyBase64 = privateKeys.ed25519PrivateKey;
    const privBytes = fromBase64(ed25519PrivateKeyBase64);
    const pubBytes = ed25519.getPublicKey(privBytes);
    ed25519PublicKeyBase64 = toBase64(pubBytes);
  } else {
    const emptyKey = toBase64(new Uint8Array(32));
    ed25519PublicKeyBase64 = emptyKey;
    ed25519PrivateKeyBase64 = emptyKey;
  }

  return deserializeKeyPair({
    x25519PublicKey: publicEncryptionKey.x25519PublicKey,
    mlKemPublicKey: publicEncryptionKey.mlKemPublicKey,
    x25519PrivateKey: privateKeys.x25519PrivateKey,
    mlKemPrivateKey: privateKeys.mlKemPrivateKey,
    ed25519PublicKey: ed25519PublicKeyBase64,
    ed25519PrivateKey: ed25519PrivateKeyBase64
  });
}
