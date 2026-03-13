import { describe, expect, it } from 'vitest';
import {
  generateKeyPair,
  serializeKeyPair,
  splitPublicKey
} from './asymmetric.js';
import {
  buildVfsPublicEncryptionKey,
  decryptVfsPrivateKeysWithPassword,
  decryptVfsPrivateKeysWithPasswordMaterial,
  decryptVfsPrivateKeysWithRawKey,
  encryptVfsPrivateKeysWithPassword,
  encryptVfsPrivateKeysWithPasswordMaterial,
  encryptVfsPrivateKeysWithRawKey,
  importVfsPrivateKeyPasswordMaterial,
  reconstructVfsKeyPair
} from './vfsKeyBundles.js';
import { encrypt, generateRandomKey, importKey } from './webCrypto.js';

describe('vfs key bundles', () => {
  it('encrypts and decrypts private keys with password (v2 bundle)', async () => {
    const keyPair = generateKeyPair();
    const serialized = serializeKeyPair(keyPair);
    const bundle = await encryptVfsPrivateKeysWithPassword(
      serialized,
      'test-password'
    );

    const privateKeys = await decryptVfsPrivateKeysWithPassword(
      bundle.encryptedPrivateKeys,
      bundle.argon2Salt,
      'test-password'
    );

    expect(privateKeys.x25519PrivateKey).toBe(serialized.x25519PrivateKey);
    expect(privateKeys.mlKemPrivateKey).toBe(serialized.mlKemPrivateKey);
    expect(privateKeys.ed25519PrivateKey).toBe(serialized.ed25519PrivateKey);
  });

  it('encrypts and decrypts private keys with imported password material', async () => {
    const keyPair = generateKeyPair();
    const serialized = serializeKeyPair(keyPair);
    const passwordMaterial =
      await importVfsPrivateKeyPasswordMaterial('test-password');
    const bundle = await encryptVfsPrivateKeysWithPasswordMaterial(
      serialized,
      passwordMaterial
    );

    const privateKeys = await decryptVfsPrivateKeysWithPasswordMaterial(
      bundle.encryptedPrivateKeys,
      bundle.argon2Salt,
      passwordMaterial
    );

    expect(privateKeys.x25519PrivateKey).toBe(serialized.x25519PrivateKey);
    expect(privateKeys.mlKemPrivateKey).toBe(serialized.mlKemPrivateKey);
  });

  it('encrypts and decrypts private keys with raw key bytes', async () => {
    const keyPair = generateKeyPair();
    const serialized = serializeKeyPair(keyPair);
    const rawKey = await generateRandomKey();
    const bundle = await encryptVfsPrivateKeysWithRawKey(serialized, rawKey);

    const privateKeys = await decryptVfsPrivateKeysWithRawKey(
      bundle.encryptedPrivateKeys,
      rawKey
    );

    expect(privateKeys.x25519PrivateKey).toBe(serialized.x25519PrivateKey);
    expect(privateKeys.mlKemPrivateKey).toBe(serialized.mlKemPrivateKey);
  });

  it('reconstructs a full keypair from public+private encoded keys', async () => {
    const keyPair = generateKeyPair();
    const serialized = serializeKeyPair(keyPair);
    const publicKey = splitPublicKey(buildVfsPublicEncryptionKey(keyPair));

    const reconstructed = reconstructVfsKeyPair(publicKey, {
      x25519PrivateKey: serialized.x25519PrivateKey,
      mlKemPrivateKey: serialized.mlKemPrivateKey,
      ed25519PrivateKey: serialized.ed25519PrivateKey
    });

    expect(reconstructed.x25519PublicKey).toEqual(keyPair.x25519PublicKey);
    expect(reconstructed.mlKemPublicKey).toEqual(keyPair.mlKemPublicKey);
    expect(reconstructed.x25519PrivateKey).toEqual(keyPair.x25519PrivateKey);
    expect(reconstructed.mlKemPrivateKey).toEqual(keyPair.mlKemPrivateKey);
    expect(reconstructed.ed25519PublicKey).toEqual(keyPair.ed25519PublicKey);
    expect(reconstructed.ed25519PrivateKey).toEqual(keyPair.ed25519PrivateKey);
  });

  it('decrypts v1 bundles with ed25519PrivateKey as null', async () => {
    const keyPair = generateKeyPair();
    const serialized = serializeKeyPair(keyPair);

    // Manually construct a v1 bundle (no ed25519PrivateKey)
    const v1Bundle = JSON.stringify({
      version: 'v1',
      x25519PrivateKey: serialized.x25519PrivateKey,
      mlKemPrivateKey: serialized.mlKemPrivateKey
    });
    const rawKey = await generateRandomKey();
    const cryptoKey = await importKey(rawKey);
    const aad = new TextEncoder().encode('tearleads-vfs-keys:v1');
    const encrypted = await encrypt(
      new TextEncoder().encode(v1Bundle),
      cryptoKey,
      aad
    );

    // Convert to base64
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < encrypted.length; i += chunkSize) {
      binary += String.fromCharCode(...encrypted.subarray(i, i + chunkSize));
    }
    const encryptedBase64 = btoa(binary);

    const privateKeys = await decryptVfsPrivateKeysWithRawKey(
      encryptedBase64,
      rawKey
    );

    expect(privateKeys.x25519PrivateKey).toBe(serialized.x25519PrivateKey);
    expect(privateKeys.mlKemPrivateKey).toBe(serialized.mlKemPrivateKey);
    expect(privateKeys.ed25519PrivateKey).toBeNull();
  });

  it('reconstructs keypair with empty ed25519 keys when ed25519PrivateKey is null', () => {
    const keyPair = generateKeyPair();
    const serialized = serializeKeyPair(keyPair);
    const publicKey = splitPublicKey(buildVfsPublicEncryptionKey(keyPair));

    const reconstructed = reconstructVfsKeyPair(publicKey, {
      x25519PrivateKey: serialized.x25519PrivateKey,
      mlKemPrivateKey: serialized.mlKemPrivateKey,
      ed25519PrivateKey: null
    });

    expect(reconstructed.x25519PublicKey).toEqual(keyPair.x25519PublicKey);
    expect(reconstructed.mlKemPublicKey).toEqual(keyPair.mlKemPublicKey);
    expect(reconstructed.ed25519PublicKey).toEqual(new Uint8Array(32));
    expect(reconstructed.ed25519PrivateKey).toEqual(new Uint8Array(32));
  });
});
