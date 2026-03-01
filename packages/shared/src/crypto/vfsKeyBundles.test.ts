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
import { generateRandomKey } from './webCrypto.js';

describe('vfs key bundles', () => {
  it('encrypts and decrypts private keys with password', async () => {
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
      mlKemPrivateKey: serialized.mlKemPrivateKey
    });

    expect(reconstructed.x25519PublicKey).toEqual(keyPair.x25519PublicKey);
    expect(reconstructed.mlKemPublicKey).toEqual(keyPair.mlKemPublicKey);
    expect(reconstructed.x25519PrivateKey).toEqual(keyPair.x25519PrivateKey);
    expect(reconstructed.mlKemPrivateKey).toEqual(keyPair.mlKemPrivateKey);
  });
});
