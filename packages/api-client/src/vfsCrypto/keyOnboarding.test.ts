import { combinePublicKey, splitPublicKey } from '@tearleads/shared';
import { describe, expect, it } from 'vitest';
import {
  createVfsOnboardingKeyBundle,
  decryptVfsPrivateKeyBundle
} from './keyOnboarding';

describe('vfs key onboarding', () => {
  it('creates a setup payload and decrypts private keys with the same password', async () => {
    const password = 'correct horse battery staple';
    const bundle = await createVfsOnboardingKeyBundle(password);
    const splitPublic = splitPublicKey(bundle.setupPayload.publicEncryptionKey);

    const decrypted = await decryptVfsPrivateKeyBundle(
      password,
      bundle.setupPayload.encryptedPrivateKeys,
      bundle.setupPayload.argon2Salt,
      splitPublic
    );

    expect(combinePublicKey(splitPublic)).toBe(bundle.setupPayload.publicEncryptionKey);
    expect(decrypted.x25519PublicKey).toEqual(bundle.keyPair.x25519PublicKey);
    expect(decrypted.mlKemPublicKey).toEqual(bundle.keyPair.mlKemPublicKey);
    expect(decrypted.x25519PrivateKey).toEqual(bundle.keyPair.x25519PrivateKey);
    expect(decrypted.mlKemPrivateKey).toEqual(bundle.keyPair.mlKemPrivateKey);
  });

  it('fails to decrypt with a different password', async () => {
    const bundle = await createVfsOnboardingKeyBundle('first-password');
    const splitPublic = splitPublicKey(bundle.setupPayload.publicEncryptionKey);

    await expect(
      decryptVfsPrivateKeyBundle(
        'wrong-password',
        bundle.setupPayload.encryptedPrivateKeys,
        bundle.setupPayload.argon2Salt,
        splitPublic
      )
    ).rejects.toBeInstanceOf(Error);
  });

  it('rejects empty passwords', async () => {
    await expect(createVfsOnboardingKeyBundle('   ')).rejects.toThrow(
      /password is required/
    );
  });
});
